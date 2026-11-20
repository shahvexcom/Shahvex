import {
  asksCallingPurpose,
  scriptPurpose,
} from "../gateway/conversation-flow.cjs";
import {
  reaffirmsHumanRequest,
  customerRequestsHuman,
  withdrawsHumanRequest,
  waitingAcknowledgment,
  affirmativeTransferConsent,
  transferConsent,
  isTransferOffer,
} from "../gateway/handoff-intent.cjs";
import type { TestConfig } from "./agent-test";
type Turn = { role: string; content: string };
const cities = [
  {
    name: "New York",
    pattern: /\bnew york(?: city)?\b/i,
    zone: "America/New_York",
    lat: 40.7128,
    lon: -74.006,
  },
  {
    name: "Chicago",
    pattern: /\bchicago\b/i,
    zone: "America/Chicago",
    lat: 41.8781,
    lon: -87.6298,
  },
  {
    name: "Los Angeles",
    pattern: /\blos angeles\b/i,
    zone: "America/Los_Angeles",
    lat: 34.0522,
    lon: -118.2437,
  },
  {
    name: "Houston",
    pattern: /\bhouston\b/i,
    zone: "America/Chicago",
    lat: 29.7604,
    lon: -95.3698,
  },
  {
    name: "Dallas",
    pattern: /\bdallas\b/i,
    zone: "America/Chicago",
    lat: 32.7767,
    lon: -96.797,
  },
  {
    name: "Miami",
    pattern: /\bmiami\b/i,
    zone: "America/New_York",
    lat: 25.7617,
    lon: -80.1918,
  },
  {
    name: "Phoenix",
    pattern: /\bphoenix\b/i,
    zone: "America/Phoenix",
    lat: 33.4484,
    lon: -112.074,
  },
  {
    name: "Seattle",
    pattern: /\bseattle\b/i,
    zone: "America/Los_Angeles",
    lat: 47.6062,
    lon: -122.3321,
  },
];
const weatherCache = new Map<string, { until: number; text: string }>();
/** Only answer the requested contextual question; never alter qualification or transfer state. */
export async function contextualQuestionReply(
  config: Pick<TestConfig, "script" | "instructions" | "knowledge"> & {
    name?: string;
  },
  text: string,
  history: Turn[],
  options: {
    now?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
) {
  const now = options.now ?? Date.now(),
    fetchImpl = options.fetchImpl ?? fetch;
  const last = history.findLast((t) => t.role === "assistant")?.content || "";
  const rebateDefinition =
    /^(?:please\s+)?(?:what(?:'s| is| does)|explain|tell me (?:about|what))\b[^?]{0,60}\brebate card\b[^?]{0,40}[?.! ]*$/i.test(
      text.trim(),
    );
  const sourceDetails = [config.script, config.knowledge].join("\n");
  const eligibilityQuestion =
    /\b(?:am I|do I|did I|have I)\b[^.!?]{0,45}\b(?:qualif(?:y|ied)|eligible|entitled|approved)\b|\bdoes\b[^.!?]{0,90}\bmean\b[^.!?]{0,45}\b(?:qualif(?:y|ied)|eligible|refund)\b/i.test(
      text,
    );
  if (
    eligibilityQuestion &&
    /medicare|medicaid|rebate|refund/i.test(sourceDetails)
  )
    return "I can't confirm eligibility or a refund from those answers alone. A licensed specialist would need to review your plan and verify what applies.";

  if (
    rebateDefinition &&
    /medicare|rebate card/i.test(sourceDetails) &&
    !/(?:rebate card (?:is|means|provides|works)|card benefits?:)/i.test(
      sourceDetails,
    )
  )
    return "A rebate card generally holds money or credit from a rebate. I don't have verified details of a specific card or an amount for your plan, so a licensed specialist would need to confirm what applies.";

  const cityReply =
    last === "Which city would you like the weather for?" &&
    /^[a-z][a-z .,'-]{1,65}$/i.test(text.trim()) &&
    !/\b(?:please|what|where|how|can|could|would|you|time|laugh|cry|sound|use|hello|hi|yes|no|okay|ok|transfer|connect)\b/i.test(
      text,
    );
  const weather =
    /\b(?:weather|temperature|raining|sunny|forecast)\b/i.test(text) ||
    cityReply;
  const time =
    /\b(?:what(?:'s| is)?(?: the)? time|what time|current time|time (?:right )?now)\b/i.test(
      text,
    );
  const location =
    /\bwhere (?:are you|do you live|you live|are you live)\b|\bwhere\b.{0,55}\b(?:calling|speaking|located|based|sitting|from)\b|\b(?:your|company|office) (?:location|address)\b/i.test(
      text,
    );
  const identity =
    /\b(?:who (?:are you|you are|is this)|who am I (?:talking|speaking) (?:to|with)|your name|what company|which company)\b/i.test(
      text,
    ) ||
    (/\bwhat about you\b/i.test(text) && location);
  const wellbeing =
    /\b(?:how are you|how do you do|how(?:'s| is| was) your day|how are you (?:feeling|doing)|what about you|how about you)\b/i.test(
      text,
    );
  const purposeQuestion = asksCallingPurpose(text);
  const politics =
    /\b(?:elections?|politic(?:s|al)?|democrats?|republicans?|who (?:will|should) win|presidential race|president|senate|congress|government|voting|candidate)\b/i.test(
      text,
    );
  if (
    !weather &&
    !time &&
    !location &&
    !identity &&
    !wellbeing &&
    !politics &&
    !purposeQuestion
  ) {
    if (
      /\b(?:are you married|will you marry me|I want to marry you)\b/i.test(
        text,
      )
    )
      return "Wedding planning is a little outside my job description! Let's get back to helping you.";
    if (/\b(?:are you (?:a )?smoker|do you smoke|you smoking)\b/i.test(text))
      return "I don't smoke; I'm an AI assistant. Smoking can harm the lungs and heart, and quitting is good for your health.";
    return;
  }
  const source = [config.knowledge, config.instructions, config.script].join(
    "\n",
  );
  const localReference =
    /\b(?:your|there|over there|where you|arizona)\b/i.test(text);
  const city =
    cities.find((c) => c.pattern.test(text)) ||
    (localReference ? cities.find((c) => c.name === "Phoenix") : undefined);
  const replies: string[] = [];
  const profile = voiceIdentity(config);
  if (identity) {
    const nameOnly =
      /\byour name\b/i.test(text) && !/\b(?:company|who|where)\b/i.test(text);
    replies.push(
      nameOnly
        ? `I'm ${profile.name}.`
        : `I'm ${profile.name}${profile.company ? ` from ${profile.company}` : ""}.`,
    );
  }
  if (purposeQuestion) {
    const purpose = scriptPurpose(config);
    replies.push(
      purpose ||
        "I don't have a confirmed calling purpose to explain, and I don't want to invent one.",
    );
  }
  if (wellbeing) replies.push("I'm doing well, thank you for asking.");
  if (politics)
    replies.push(
      "I keep politics out of this call, but I hope the outcome serves people's needs fairly. I don't have verified election updates to share.",
    );

  if (weather) {
    if (!city) replies.push("Which city would you like the weather for?");
    else {
      const cached = weatherCache.get(city.name);
      if (cached && cached.until > now) replies.push(cached.text);
      else
        try {
          const get = async (url: string) => {
            const response = await fetchImpl(url, {
              headers: {
                "User-Agent": "ShahvexCallAssistant (https://shahvex.com)",
                Accept: "application/geo+json",
              },
              redirect: "error",
              signal: AbortSignal.any([
                options.signal ?? new AbortController().signal,
                AbortSignal.timeout(4000),
              ]),
            });
            if (!response.ok) throw Error("Weather unavailable");
            return response.json();
          };
          const point = await get(
              `https://api.weather.gov/points/${city.lat},${city.lon}`,
            ),
            url = new URL(point.properties?.forecastHourly || "");
          if (
            url.origin !== "https://api.weather.gov" ||
            !url.pathname.startsWith("/gridpoints/")
          )
            throw Error("Invalid weather source");
          const forecast = await get(url.href),
            period = forecast.properties?.periods?.find(
              (p: { startTime: string; endTime: string }) =>
                Date.parse(p.startTime) <= now && Date.parse(p.endTime) > now,
            );
          if (
            !period ||
            !Number.isFinite(period.temperature) ||
            !["F", "C"].includes(period.temperatureUnit) ||
            typeof period.shortForecast !== "string" ||
            period.shortForecast.length > 120
          )
            throw Error("Current forecast unavailable");
          const answer = `The latest National Weather Service hourly forecast for ${city.name} is ${Math.round(period.temperature)} degrees ${period.temperatureUnit === "F" ? "Fahrenheit" : "Celsius"}, ${period.shortForecast.toLowerCase()}.`;
          if (weatherCache.size >= 50) weatherCache.clear();
          weatherCache.set(city.name, { until: now + 120000, text: answer });
          replies.push(answer);
        } catch {
          replies.push(
            `I couldn't retrieve the live weather for ${city.name} just now, so I don't want to guess.`,
          );
        }
    }
  }
  if (time) {
    const configured =
      /(?:time\s*zone|timezone)\s*:\s*([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?|UTC)/i.exec(
        source,
      )?.[1];
    let zone = city?.zone || configured || "America/Phoenix";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(now);
    } catch {
      zone = "UTC";
    }
    replies.push(
      `It's ${new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now)} ${city ? `in ${city.name}` : zone === "UTC" ? "UTC" : zone.replaceAll("_", " ")}.`,
    );
  }
  if (location) {
    const office =
      /(?:office location|company location|office address)\s*:\s*([^\n]{3,160})/i
        .exec(source)?.[1]
        ?.split(/\s+Time\s?zone\s*:/i)[0]
        ?.replace(/[., ]+$/, "")
        .trim();
    replies.push(
      office
        ? `Our listed office location is ${office}.`
        : "We are based in Phoenix, Arizona, United States of America.",
    );
  }
  if (time && /\b(?:laptop|cellphone|cell phone|mobile|device)\b/i.test(text))
    replies.push("This call is through our calling system.");
  return replies.join(" ");
}

/** A greeting acknowledgment cannot answer a script question that has never been asked. */
export function initialScriptQuestion(
  script: string,
  text: string,
  history: { role: string; content: string }[],
) {
  if (
    !/^(?:yes|yeah|yep|okay|ok|sure|all right|alright)[.! ,]*$/i.test(
      text.trim(),
    )
  )
    return undefined;
  const spoken = history.filter((t) => t.role === "assistant");
  if (
    spoken.length !== 1 ||
    !/^(?:hello|hi|hey)\b/i.test(spoken[0].content.trim()) ||
    spoken[0].content.includes("?")
  )
    return undefined;
  const question = script
    .match(
      /\b(?:are you|do you|have you|is your|what (?:is|are)|how (?:old|many|much)|can you|would you|may I|will you|which \w+)\b[^?\n]*\?/i,
    )?.[0]
    ?.trim();
  return question && question.length <= 600 ? question : undefined;
}

/** Only wording for an acknowledgment after a spoken transfer offer; no call control. */
export function transferAcknowledgment(
  text: string,
  history: { role: string; content: string }[],
  script = "",
) {
  const requested = customerRequestsHuman(text, history);
  const statusQuestion =
    /\b(?:how (?:much )?long|why.*waiting|are you (?:still )?(?:transferring|connecting)|have you (?:transferred|connected)|did you (?:transfer|connect))\b/i.test(
      text,
    );
  if (!requested && !statusQuestion && !waitingAcknowledgment(text))
    return undefined;
  let offered = false,
    updates = 0,
    requestedPreviously = false;
  for (const turn of history) {
    if (turn.role === "user" && withdrawsHumanRequest(turn.content)) {
      offered = false;
      updates = 0;
      requestedPreviously = false;
      continue;
    }
    if (turn.role === "user" && customerRequestsHuman(turn.content))
      requestedPreviously = true;
    if (turn.role !== "assistant") continue;
    if (
      /\b(?:cannot|can't|unable to|cancel(?:led|ed)?)\s+(?:connect|transfer)|\btransfer (?:failed|cancelled|canceled)\b/i.test(
        turn.content,
      )
    ) {
      offered = false;
      updates = 0;
      requestedPreviously = false;
      continue;
    }
    offered = isTransferOffer(turn);
    if (
      /^(?:Please wait while I connect you to the [a-z ]+\.|Your connection request is in progress\.|Alright, please wait\.|Okay, I am going to connect you\. Just hold for me\.)$/i.test(
        turn.content.trim(),
      )
    )
      updates++;
  }
  if (!requested && !requestedPreviously && !offered && !updates)
    return undefined;
  if (
    !requested &&
    !statusQuestion &&
    !affirmativeTransferConsent(text) &&
    !transferConsent(history)
  )
    return undefined;
  if (statusQuestion || (updates > 0 && reaffirmsHumanRequest(text, history))) {
    const status = "I don't have confirmation of a completed transfer yet.";
    return history.some((t) => t.role === "assistant" && t.content === status)
      ? ""
      : status;
  }
  // Silence after one acknowledgment and one status update prevents a waiting loop.
  return updates === 0 ? "Alright, please wait." : "";
}

/** Fast flexible opening; explicit mandatory/verbatim openings stay with the model. */
export function briefAgentOpening(
  config: Pick<TestConfig, "name" | "script" | "instructions">,
) {
  if (
    /\b(?:verbatim|exact (?:opening|wording)|mandatory disclosure|read exactly)\b/i.test(
      config.script + " " + config.instructions,
    )
  )
    return undefined;
  const script = config.script;
  const identity =
    /\b(?:this is|introduce yourself as|my name is|your name is|I['’]m|you are named)\s+([A-Za-z][A-Za-z'-]{0,40})(?:\s+(?:from|with)\s+([^.!?\n,]{2,90}))?/i.exec(
      script,
    );
  const company =
    identity?.[2]?.trim() ||
    /(?:company(?: name)?\s*:\s*|calling (?:from|on behalf of)\s+)([^.!?\n,]{2,90})/i
      .exec(script)?.[1]
      ?.trim();
  const candidate = identity?.[1];
  const name =
    candidate &&
    !/^(?:the|your|an?|assistant|agent|from|with)$/i.test(candidate)
      ? candidate
      : config.name;
  return `Hello, this is ${name}${company ? ` from ${company}` : ""}. How are you doing today?`;
}

export function voiceIdentity(
  config: Pick<TestConfig, "script" | "instructions"> & { name?: string },
) {
  const source = config.script + "\n" + config.instructions;
  const match =
    /\b(?:this is|my name is|your name is|you are|introduce yourself as|I['’]m)\s+([A-Za-z][A-Za-z'-]{0,40})(?:\s+(?:from|with)\s+([^.!?\n,]{2,90}))?/i.exec(
      source,
    );
  const candidate = match?.[1];
  const name =
    candidate &&
    !/^(?:the|your|an?|AI|calling|assistant|agent|from|with)$/i.test(candidate)
      ? candidate
      : config.name || "your calling assistant";
  const company =
    match?.[2]?.trim() ||
    /(?:company(?: name)?\s*:\s*|representing\s+|calling (?:from|on behalf of)\s+)([^.!?\n,]{2,90})/i
      .exec(source)?.[1]
      ?.trim();
  return { name, company };
}


/** Answer only the configured calling-team role; never invent government or licensing affiliation. */
export function configuredRepresentativeReply(config: Pick<TestConfig,"script"|"instructions"> & {name?:string;task?:string;goal?:string},text:string) {
 if(!/\b(?:are you|you are|you['’]re)\b[^?]{0,90}\b(?:representative|sales rep|sales agent)\b|^\s*(?:[a-z]+\s+){0,5}representative[,? ]+(?:right|correct)[?! .]*$/i.test(text))return;
 if(/\b(?:why|because|government|official|federal|licensed|certified|not|isn['’]t|aren['’]t)\b/i.test(text))return;
 const identity=voiceIdentity(config);if(!identity.company)return;
 const asked=text.toLowerCase().replace(/\b(?:are|you|a|an|the|with|from|representative|sales|rep|agent|right|correct|of)\b/g,'').replace(/[^a-z ]/g,'').trim();
 const words=asked.split(/\s+/).filter(Boolean);if(words.some(word=>!identity.company!.toLowerCase().includes(word)))return;
 const source=[config.script,config.instructions,config.task||'',config.goal||''].join('\n');
 const role=/\bsales (?:representative|rep|agent)\b/i.test(source)?'sales representative':/\brepresentative\b/i.test(source)?'representative':undefined;
 return role?`Yes, I'm a ${role} with ${identity.company}.`:`I'm calling with ${identity.company}.`;
}
