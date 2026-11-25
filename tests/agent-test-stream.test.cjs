const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const code = ts.transpileModule(
  fs.readFileSync("lib/agent-test-stream.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", code)(require, mod, mod.exports);
const { streamAgentReply } = mod.exports;
const pcmHeaders = {
  "x-audio-format": "pcm_s16le",
  "x-sample-rate": "24000",
  "x-channels": "1",
};
const enc = new TextEncoder();
// Provide a full second of PCM for fixtures that exercise Lissa's normal playback path.
const normalPcmFixtureBytes = 48000;

test("split emoji/status tags never reach TTS and marker-only output starts no audio job", async () => {
  const spoken = [];
  const options = {
    messages: [],
    voice: "lissa",
    signal: new AbortController().signal,
    onText: () => {},
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          ["Hello 😊 [inter", "rupted] there.", " [interrupted]"]
            .map((text, i) =>
              JSON.stringify({ message: { content: text }, done: i === 2 }),
            )
            .join("\n") + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  };
  await streamAgentReply(options);
  assert.deepEqual(spoken, ["Hello there."]);
  spoken.length = 0;
  await streamAgentReply({ ...options, fixedSpeech: "[interrupted] 😊" });
  assert.equal(spoken.length, 0);
});
test(
  "local phrase mode starts TTS before the rest of a long sentence arrives without changing text",
  { timeout: 3000 },
  async () => {
    const first =
      "The consultation fee for your first clinic visit is 2,000 PKR,";
    const rest = " and our staff must confirm your preferred appointment time.";
    let release,
      seenFirst = false,
      full = "";
    const spoken = [];
    const started = new Promise((resolve) => {
      release = resolve;
    });
    await streamAgentReply({
      phraseStreaming: true,
      messages: [],
      voice: "selected",
      signal: new AbortController().signal,
      onText: (text) => {
        full = text;
      },
      send: async () => {},
      timing: async () => {},
      engine: async (port, path, init) => {
        if (port === 11434)
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(
                  enc.encode(
                    JSON.stringify({ message: { content: first + " " } }) +
                      "\n",
                  ),
                );
                await started;
                assert.equal(seenFirst, true);
                controller.enqueue(
                  enc.encode(
                    JSON.stringify({
                      message: { content: rest.trimStart() },
                      done: true,
                    }) + "\n",
                  ),
                );
                controller.close();
              },
            }),
          );
        spoken.push(JSON.parse(init.body).text);
        seenFirst = true;
        release();
        return new Response(new Uint8Array(1920).fill(12), {
          headers: pcmHeaders,
        });
      },
    });
    assert.equal(full, first + " " + rest.trimStart());
    assert.match(spoken[0], /two thousand Pakistani rupees/);
    assert.equal(spoken.length, 2);
  },
);
test("LLM completes while first TTS is in flight; first PCM precedes synthesis completion and sentences stay ordered", async () => {
  const events = [],
    spoken = [],
    timings = [];
  let release,
    completed = false,
    text = "";
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  await streamAgentReply({
    messages: [],
    voice: "selected-voice",
    signal: new AbortController().signal,
    onText: (value) => {
      text = value;
    },
    send: async (e) => {
      events.push(e);
    },
    timing: async (stage) => {
      timings.push(stage);
      if (stage === "llm-completed") {
        completed = true;
        release();
      }
    },
    engine: async (port, path, init) => {
      const body = JSON.parse(init.body);
      if (port === 11434) {
        assert.equal(body.stream, true);
        assert.equal(body.options.num_predict, -1);
        assert.equal(body.keep_alive, "30m");
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                enc.encode(
                  JSON.stringify({
                    message: { content: "First complete sentence." },
                  }) + "\n",
                ),
              );
              c.enqueue(
                enc.encode(
                  JSON.stringify({
                    message: { content: " Second complete sentence." },
                    done: true,
                  }) + "\n",
                ),
              );
              c.close();
            },
          }),
        );
      }
      assert.equal(path, "/stream");
      assert.equal(body.voice_id, "selected-voice");
      spoken.push(body.text);
      return new Response(
        new ReadableStream({
          async start(c) {
            await waiting;
            assert.equal(completed, true);
            c.enqueue(new Uint8Array(4801).fill(16));
            await new Promise((resolve) => setTimeout(resolve, 5));
            assert.ok(events.some((e) => e.type === "pcm"));
            c.enqueue(new Uint8Array(1));
            c.close();
          },
        }),
        { headers: pcmHeaders },
      );
    },
  });
  assert.deepEqual(spoken, [
    "First complete sentence.",
    "Second complete sentence.",
  ]);
  assert.equal(text, "First complete sentence. Second complete sentence.");
  assert.ok(
    timings.indexOf("tts-request-started") < timings.indexOf("llm-completed"),
  );
  assert.ok(
    timings.indexOf("first-pcm-received") <
      timings.indexOf("sentence-synthesis-completed"),
  );
  assert.ok(
    events
      .filter((e) => e.type === "pcm")
      .every((e) => Buffer.from(e.data, "base64").length % 2 === 0),
  );
});
test("interrupt cancels stale audio and prevents queued sentence requests", async () => {
  const abort = new AbortController();
  const events = [];
  let requests = 0;
  await assert.rejects(
    streamAgentReply({
      messages: [],
      voice: "selected",
      signal: abort.signal,
      onText: () => {},
      timing: async () => {},
      send: async (event) => {
        events.push(event);
        if (event.type === "pcm") abort.abort();
      },
      engine: async (port) => {
        if (port === 11434)
          return new Response(
            JSON.stringify({
              message: {
                content: "Sentence one. Sentence two. Sentence three.",
              },
              done: true,
            }) + "\n",
          );
        requests++;
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(9600).fill(16));
              c.close();
            },
          }),
          { headers: pcmHeaders },
        );
      },
    }),
    /abort/i,
  );
  assert.equal(requests, 1);
  assert.equal(events.filter((e) => e.type === "pcm").length, 1);
});
test("worklet resamples PCM, clears immediately, rejects stale epochs, and drains a small final buffer", () => {
  for (const rate of [16000, 48000]) {
    let Worklet;
    const messages = [];
    class Processor {
      constructor() {
        this.port = { postMessage: (e) => messages.push(e) };
      }
    }
    vm.runInNewContext(
      fs.readFileSync("public/shahvex-playback-worklet.js", "utf8"),
      {
        AudioWorkletProcessor: Processor,
        Float32Array,
        Int16Array,
        sampleRate: rate,
        currentTime: 0,
        registerProcessor: (name, klass) => {
          Worklet = klass;
        },
      },
    );
    const player = new Worklet();
    const pcm = new Int16Array(2400).fill(16384);
    player.port.onmessage({ data: { type: "pcm", epoch: 0, pcm: pcm.buffer } });
    const output = new Float32Array(128);
    player.process([], [[output]]);
    assert.ok(output.every((x) => Math.abs(x - 0.5) < 0.001));
    player.port.onmessage({ data: { type: "clear", epoch: 1 } });
    player.port.onmessage({ data: { type: "pcm", epoch: 0, pcm: pcm.buffer } });
    player.process([], [[output]]);
    assert.ok(output.every((x) => x === 0));
    player.port.onmessage({
      data: {
        type: "pcm",
        epoch: 1,
        pcm: new Int16Array(500).fill(8192).buffer,
      },
    });
    player.port.onmessage({ data: { type: "end", epoch: 1 } });
    player.process([], [[output]]);
    assert.ok(output.some((x) => x > 0));
    for (let i = 0; i < 20; i++) player.process([], [[output]]);
    assert.ok(output.every((x) => x === 0));
    assert.ok(messages.some((e) => e.type === "started" && e.epoch === 1));
    assert.equal(
      messages.filter((e) => e.type === "started" || e.type === "idle").at(-1)
        .type,
      "idle",
    );
    const starts = messages.filter((e) => e.type === "started").length;
    player.port.onmessage({
      data: { type: "pcm", epoch: 1, pcm: new Int16Array(2400).buffer },
    });
    for (let i = 0; i < 50; i++) player.process([], [[output]]);
    assert.equal(
      messages.filter((e) => e.type === "started").length,
      starts,
      "silent PCM must not announce speaking",
    );
  }
});
test("empty or silent upstream PCM reports a synthesis error", async () => {
  await assert.rejects(
    streamAgentReply({
      messages: [],
      voice: "selected",
      signal: new AbortController().signal,
      onText: () => {},
      send: async () => {},
      timing: async () => {},
      engine: async (port) =>
        port === 11434
          ? new Response(
              JSON.stringify({
                message: { content: "A full answer." },
                done: true,
              }) + "\n",
            )
          : new Response(new Uint8Array(4800), { headers: pcmHeaders }),
    }),
    /empty or silent/,
  );
});

test("time-permission questions split across model tokens never reach transcript, memory or speech", async () => {
  for (const phraseStreaming of [false, true]) {
    for (const question of [
      "Is now an okay time?",
      "Is this a good time?",
      "Do you have a quick minute?",
      "Is time good?",
      "Are you available to talk?",
      "Can we talk?",
      "Is now okay?",
    ]) {
      let full = "";
      const events = [],
        spoken = [];
      const output = "I am calling about rebate updates. " + question;
      await streamAgentReply({
        allowTimePermission: false,
        phraseStreaming,
        messages: [],
        voice: "selected",
        signal: new AbortController().signal,
        onText: (text) => {
          full = text;
        },
        send: async (event) => {
          events.push(event);
        },
        timing: async () => {},
        engine: async (port, path, init) => {
          if (port === 11434)
            return new Response(
              [...output]
                .map((text, i) =>
                  JSON.stringify({
                    message: { content: text },
                    done: i === output.length - 1,
                  }),
                )
                .join("\n") + "\n",
            );
          spoken.push(JSON.parse(init.body).text);
          return new Response(new Uint8Array(1920).fill(12), {
            headers: pcmHeaders,
          });
        },
      });
      assert.equal(full.trim(), "I am calling about rebate updates.", question);
      assert.equal(
        events
          .filter((e) => e.type === "delta")
          .map((e) => e.text)
          .join("")
          .trim(),
        full.trim(),
      );
      assert.deepEqual(spoken, ["I am calling about rebate updates."]);
    }
  }
});

test("model-generated interruption markers never reach transcript or stored answer", async () => {
  let full = "";
  const deltas = [],
    spoken = [];
  const chunks = [
    "I heard you. [inter",
    "rupted] [interrupted]",
    " [interrupted by customer]",
  ];
  await streamAgentReply({
    messages: [],
    voice: "selected",
    signal: new AbortController().signal,
    onText: (text) => {
      full = text;
    },
    send: async (event) => {
      if (event.type === "delta") deltas.push(event.text);
    },
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          chunks
            .map((text, i) =>
              JSON.stringify({
                message: { content: text },
                done: i === chunks.length - 1,
              }),
            )
            .join("\n") + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(1920).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(full.trim(), "I heard you.");
  assert.equal(deltas.join("").trim(), "I heard you.");
  assert.deepEqual(spoken, ["I heard you."]);
});

test("approved expression uses metadata, exactly one existing LLM request and unchanged transcript", async (t) => {
  const old = process.env.SHAHVEX_LISSA_EMOTIONS;
  process.env.SHAHVEX_LISSA_EMOTIONS = "1";
  t.after(() => {
    if (old === undefined) delete process.env.SHAHVEX_LISSA_EMOTIONS;
    else process.env.SHAHVEX_LISSA_EMOTIONS = old;
  });
  const spoken = [],
    events = [];
  let llm = 0,
    answer = "";
  const text = "That really made me smile. Thank you for sharing that.";
  await streamAgentReply({
    messages: [],
    voice: "lissa",
    customerText: "Hahaha, that was funny.",
    emotionState: { turn: 0 },
    signal: new AbortController().signal,
    onText: (t) => {
      answer = t;
    },
    timing: async () => {},
    send: async (e) => events.push(e),
    engine: async (port, _path, init) => {
      if (port === 11434) {
        llm++;
        return new Response(
          JSON.stringify({ message: { content: text }, done: true }) + "\n",
        );
      }
      spoken.push(JSON.parse(init.body));
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(llm, 1);
  assert.equal(answer, text);
  assert.equal(spoken.filter((x) => x.emotion === "laugh").length, 1);
  assert.equal(spoken[1].emotion, undefined);
  assert.ok(spoken.every((x) => !x.text.includes("[laughter]")));
  assert.equal(
    events
      .filter((x) => x.type === "delta")
      .map((x) => x.text)
      .join(""),
    text,
  );
});
test("fixed presence checks and non-Lissa voices keep the original voice request", async (t) => {
  const old = process.env.SHAHVEX_LISSA_EMOTIONS;
  process.env.SHAHVEX_LISSA_EMOTIONS = "1";
  t.after(() => {
    if (old === undefined) delete process.env.SHAHVEX_LISSA_EMOTIONS;
    else process.env.SHAHVEX_LISSA_EMOTIONS = old;
  });
  for (const voice of ["lissa", "af_heart"]) {
    const calls = [];
    await streamAgentReply({
      messages: [],
      voice,
      customerText: "hahaha that was funny",
      fixedSpeech: "That was funny.",
      signal: new AbortController().signal,
      onText: () => {},
      timing: async () => {},
      send: async () => {},
      engine: async (port, _path, init) => {
        assert.equal(port, 8767);
        calls.push(JSON.parse(init.body));
        return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
          headers: pcmHeaders,
        });
      },
    });
    assert.deepEqual(calls, [{ text: "That was funny.", voice_id: voice }]);
  }
});
test("approved calm reassurance stays metadata-only and uses no additional LLM call", async (t) => {
  const old = process.env.SHAHVEX_LISSA_EMOTIONS;
  process.env.SHAHVEX_LISSA_EMOTIONS = "1";
  t.after(() => {
    if (old === undefined) delete process.env.SHAHVEX_LISSA_EMOTIONS;
    else process.env.SHAHVEX_LISSA_EMOTIONS = old;
  });
  let llm = 0,
    answer = "";
  const calls = [];
  const text = "I understand. We can take this one step at a time.";
  await streamAgentReply({
    messages: [],
    voice: "lissa",
    customerText: "I feel confused and worried.",
    emotionState: { turn: 0 },
    signal: new AbortController().signal,
    onText: (t) => {
      answer = t;
    },
    send: async () => {},
    timing: async () => {},
    engine: async (port, _path, init) => {
      if (port === 11434) {
        llm++;
        return new Response(
          JSON.stringify({ message: { content: text }, done: true }) + "\n",
        );
      }
      calls.push(JSON.parse(init.body));
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(llm, 1);
  assert.equal(answer, text);
  assert.equal(calls.filter((c) => c.emotion === "reassure").length, 1);
  assert.ok(calls.every((c) => !c.text.includes("[")));
});
test("explicit expression demonstration laughs on the fixed answer without an LLM request", async (t) => {
  const old = process.env.SHAHVEX_LISSA_EMOTIONS;
  process.env.SHAHVEX_LISSA_EMOTIONS = "1";
  t.after(() => {
    if (old === undefined) delete process.env.SHAHVEX_LISSA_EMOTIONS;
    else process.env.SHAHVEX_LISSA_EMOTIONS = old;
  });
  const calls = [];
  let answer = "";
  await streamAgentReply({
    messages: [],
    voice: "lissa",
    customerText: "Do you have expressions?",
    fixedSpeech: "Yes, I do have expressions.",
    emotionState: { turn: 5, lastTurn: 5, total: 6 },
    signal: new AbortController().signal,
    onText: (s) => {
      answer = s;
    },
    timing: async () => {},
    send: async () => {},
    engine: async (port, _path, init) => {
      assert.equal(port, 8767);
      calls.push(JSON.parse(init.body));
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(answer, "Yes, I do have expressions.");
  assert.deepEqual(calls, [
    { text: answer, voice_id: "lissa", emotion: "laugh" },
  ]);
});

test("situational filler words reach cloning TTS unchanged for every selectable clone", async () => {
  for (const voice of ["lissa", "emma", "olivia"]) {
    const spoken = [];
    await streamAgentReply({
      messages: [],
      voice,
      signal: new AbortController().signal,
      onText: () => {},
      send: async () => {},
      timing: async () => {},
      engine: async (port, path, init) => {
        if (port === 11434)
          return new Response(
            JSON.stringify({
              message: { content: "Mm-hmm, what time are you usually free?" },
              done: true,
            }) + "\n",
          );
        const body = JSON.parse(init.body);
        assert.equal(body.voice_id, voice);
        spoken.push(body.text);
        return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
          headers: pcmHeaders,
        });
      },
    });
    assert.deepEqual(spoken, ["Mm-hmm, what time are you usually free?"]);
  }
});

test("split patience filler is removed before transcript and TTS while the actual question stays intact", async () => {
  for (const phraseStreaming of [false, true]) {
    let answer = "";
    const spoken = [],
      deltas = [];
    await streamAgentReply({
      phraseStreaming,
      messages: [],
      voice: "lissa",
      signal: new AbortController().signal,
      onText: (t) => {
        answer = t;
      },
      send: async (e) => {
        if (e.type === "delta") deltas.push(e.text);
      },
      timing: async () => {},
      engine: async (port, _path, init) => {
        if (port === 11434)
          return new Response(
            [
              "Got it, thank",
              " you for your patience. ",
              "Do you have Medicare Part A or Part B?",
            ]
              .map((content, i) =>
                JSON.stringify({ message: { content }, done: i === 2 }),
              )
              .join("\n") + "\n",
          );
        spoken.push(JSON.parse(init.body).text);
        return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
          headers: pcmHeaders,
        });
      },
    });
    assert.equal(answer.trim(), "Do you have Medicare Part A or Part B?");
    assert.equal(deltas.join("").trim(), answer.trim());
    assert.deepEqual(spoken, ["Do you have Medicare Part A or Part B?"]);
  }
});

test("answered questions are removed before text and TTS; the next unanswered question remains", async () => {
  const spoken = [],
    events = [];
  let final = "";
  await streamAgentReply({
    completedQuestions: ["Do you have Medicaid?"],
    messages: [],
    voice: "lissa",
    signal: new AbortController().signal,
    onText: (v) => (final = v),
    send: async (e) => events.push(e),
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          JSON.stringify({
            message: {
              content: "Do you currently have Medicaid? What is your age?",
            },
            done: true,
          }) + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(final.trim(), "What is your age?");
  assert.deepEqual(spoken, ["What is your age?"]);
  assert.ok(
    !events
      .filter((e) => e.type === "delta")
      .some((e) => /Medicaid/.test(e.text)),
  );
});
test("a reply containing only an answered question gets one bounded correction attempt", async () => {
  let models = 0,
    final = "";
  await streamAgentReply({
    completedQuestions: ["Do you have Medicaid?"],
    messages: [{ role: "system", content: "Follow the script." }],
    voice: "lissa",
    signal: new AbortController().signal,
    onText: (v) => (final = v),
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434) {
        models++;
        return new Response(
          JSON.stringify({
            message: {
              content:
                models === 1 ? "Do you have Medicaid?" : "What is your age?",
            },
            done: true,
          }) + "\n",
        );
      }
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(models, 2);
  assert.equal(final, "What is your age?");
});

test("repeated self-introduction and paraphrased permission are suppressed after permission was answered", async () => {
  let final = "";
  const spoken = [];
  await streamAgentReply({
    completedQuestions: ["May I ask you a few questions?"],
    introducedName: "Alex",
    messages: [],
    voice: "lissa",
    signal: new AbortController().signal,
    onText: (v) => (final = v),
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          JSON.stringify({
            message: {
              content:
                "I'm Alex from Wellness Team. Would you mind if I ask you a few questions? Do you have Medicare Part A and Part B?",
            },
            done: true,
          }) + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(final.trim(), "Do you have Medicare Part A and Part B?");
  assert.equal(spoken.length, 1);
});

test("outbound goal speech stays short while retaining the actual question and suppressing inbound service-desk wording", async () => {
  let final = "";
  const spoken = [];
  const options = {
    messages: [],
    voice: "lissa",
    maxStatementSentences: 3,
    outbound: true,
    signal: new AbortController().signal,
    onText: (v) => (final = v),
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          JSON.stringify({
            message: {
              content:
                "First purpose sentence. Second purpose sentence. Third purpose sentence. Fourth unnecessary sentence. Fifth unnecessary sentence. May I know your exact age?",
            },
            done: true,
          }) + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  };
  await streamAgentReply(options);
  assert.match(final, /May I know your exact age/);
  assert.doesNotMatch(final, /Fourth|Fifth|assist/);
  assert.equal(spoken.length, 4);
  spoken.length = 0;
  await streamAgentReply({
    ...options,
    fixedSpeech: "May I know your exact age?",
  });
  assert.equal(final, "May I know your exact age?");
  assert.deepEqual(spoken, ["May I know your exact age?"]);
});

test("acknowledgment-only model output is held and repaired before any filler reaches speech", async () => {
  let modelCalls = 0;
  const spoken = [];
  let answer = "";
  await streamAgentReply({
    messages: [{ role: "system", content: "Ask the pending script question." }],
    voice: "voice",
    signal: new AbortController().signal,
    onText: (t) => {
      answer = t;
    },
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          JSON.stringify({
            message: {
              content: ++modelCalls === 1 ? "Mm-hmm." : "Do you have coverage?",
            },
            done: true,
          }) + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(4800).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(modelCalls, 2);
  assert.equal(answer, "Do you have coverage?");
  assert.deepEqual(spoken, ["Do you have coverage?"]);
});

test("wellbeing greeting can only be spoken once even when the model changes its wording", async () => {
  let result = "";
  const spoken = [];
  await streamAgentReply({
    messages: [
      { role: "assistant", content: "Hello. How are you today?" },
      { role: "user", content: "I am good. How about you?" },
    ],
    voice: "voice",
    signal: new AbortController().signal,
    onText: (t) => {
      result = t;
    },
    send: async () => {},
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434)
        return new Response(
          JSON.stringify({
            message: {
              content:
                "I'm doing well. How are you doing? Which day works for you?",
            },
            done: true,
          }) + "\n",
        );
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(4800).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.doesNotMatch(result, /How are you/);
  assert.match(result, /Which day/);
  assert.ok(spoken.every((t) => !t.includes("How are you")));
});

test("cached speech replays identical PCM without another synthesis request", async () => {
  require("../gateway/tts-pcm-cache.cjs").shared.clear();
  let syntheses = 0;
  const outputs = [];
  const options = {
    cacheAudio: true,
    fixedSpeech: "A cache isolation test.",
    messages: [],
    voice: "cache-test",
    signal: new AbortController().signal,
    onText: () => {},
    timing: async () => {},
    send: async (e) => {
      if (e.type === "pcm") outputs.push(e.data);
    },
    engine: async () => {
      syntheses++;
      return new Response(new Uint8Array(4800).fill(12), {
        headers: pcmHeaders,
      });
    },
  };
  await streamAgentReply(options);
  const first = outputs.splice(0);
  await streamAgentReply(options);
  assert.equal(syntheses, 1);
  assert.deepEqual(outputs, first);
  require("../gateway/tts-pcm-cache.cjs").shared.clear();
});

test("history replay and copied customer answers are blocked before transcript and TTS, then retried once", async () => {
  const spoken = [],
    events = [];
  let calls = 0,
    full = "";
  const history = [
    { role: "system", content: "Answer the customer." },
    {
      role: "assistant",
      content: "I'm good, thanks! I'm calling about the benefit review.",
    },
    { role: "user", content: "Yes." },
    { role: "assistant", content: "Do you have Part A and B?" },
    { role: "user", content: "Part A and B." },
  ];
  await streamAgentReply({
    messages: history,
    customerText: "Are you serious?",
    voice: "lissa",
    phraseStreaming: true,
    signal: new AbortController().signal,
    onText: (t) => {
      full = t;
    },
    send: async (e) => {
      events.push(e);
    },
    timing: async () => {},
    engine: async (port, path, init) => {
      if (port === 11434) {
        calls++;
        const text =
          calls === 1
            ? "I'm good, thanks! I'm calling about the benefit review. Yes. Part A and B."
            : "I missed your point. What would you like to ask?";
        return new Response(
          JSON.stringify({ message: { content: text }, done: true }) + "\n",
        );
      }
      spoken.push(JSON.parse(init.body).text);
      return new Response(new Uint8Array(normalPcmFixtureBytes).fill(12), {
        headers: pcmHeaders,
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(full, "I missed your point. What would you like to ask?");
  assert.deepEqual(spoken, [
    "I missed your point.",
    "What would you like to ask?",
  ]);
  assert.ok(
    !events
      .filter((e) => e.type === "delta")
      .some((e) => /Part A|benefit review/.test(e.text)),
  );
});

test(
  "a first complete sentence emits PCM before model completion and a split decimal stays intact",
  { timeout: 3000 },
  async () => {
    const spoken = [],
      stages = [];
    let release;
    const firstPcm = new Promise((resolve) => {
      release = resolve;
    });
    const line = (content, done = false) =>
      enc.encode(
        JSON.stringify({
          message: { content, thinking: "private reasoning" },
          done,
        }) + "\n",
      );
    await streamAgentReply({
      messages: [],
      voice: "selected",
      signal: new AbortController().signal,
      onText: () => {},
      timing: async (stage) => {
        stages.push(stage);
      },
      send: async (event) => {
        if (event.type === "pcm") release();
      },
      engine: async (port, path, init) => {
        if (port === 11434)
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(
                  line("Here is the current rate. The rate is 3."),
                );
                await firstPcm;
                assert.deepEqual(spoken, ["Here is the current rate."]);
                controller.enqueue(line("50 dollars. Ask at reception", true));
                controller.close();
              },
            }),
          );
        spoken.push(JSON.parse(init.body).text);
        return new Response(new Uint8Array(1920).fill(12), {
          headers: pcmHeaders,
        });
      },
    });
    assert.equal(spoken.length, 3);
    assert.match(spoken[1], /3\.50|three.*fifty/i);
    assert.equal(spoken[2], "Ask at reception");
    assert.ok(
      stages.indexOf("first-pcm-received") < stages.indexOf("llm-completed"),
    );
  },
);

test("structured model output is rejected before synthesis", async () => {
  let syntheses = 0;
  await assert.rejects(
    streamAgentReply({
      messages: [],
      voice: "selected",
      signal: new AbortController().signal,
      onText: () => {},
      send: async () => {},
      timing: async () => {},
      engine: async (port) => {
        if (port !== 11434) {
          syntheses++;
          throw Error("Unexpected synthesis");
        }
        return new Response(
          ["<thi", "nk>Private reasoning."]
            .map((content) => JSON.stringify({ message: { content } }))
            .join("\n") + "\n",
        );
      },
    }),
    /Unexpected structured content/,
  );
  assert.equal(syntheses, 0);
});
