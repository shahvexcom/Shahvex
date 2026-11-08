"""Build two pinned components and one release manifest; never writes physical files."""
import hashlib
import json
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
physical=Path(r'C:\Shahvex-AI\integration-gateway')
digest=lambda data:hashlib.sha256(data).hexdigest().upper()
originals={
    'core.cjs':'6BA39C758B00E874A13F7C7539E9666FF675F822121916CEB5D6809D0268BC84',
    'audio-stream.cjs':'4838FD94D77C6EB8A8C6EADEE156EEE6B314FF7DFB715521D037C9DDEA5E67C7',
    'services.cjs':'3CC7695921751ADF311AACA68A53CE249AADE20B3D8B3D59A06F938D308DC265',
    'telemetry.cjs':'A06C651B1C1095B44374A5F10738FE5ADEACCB87249F14D4F99F4704986078D8',
    'phrase-stream.cjs':None,
}
first_audio='4C6B08C47BC643C6A81BC48EB30AD7389722A3D620DDD78E1E7AAB31EBCDD34B'
if digest((physical/'text-chunks.cjs').read_bytes())!=first_audio:raise SystemExit('FirstAudio helper changed')
review=(b'# Coordinated VoiceStreaming cumulative integration release\n\n'
        b'This component release supersedes earlier deployment bundles. The two reviews below are historical evidence and implementation reviews; their old package references are not the deployment instructions for this release. Use docs/coordinated-voice-streaming-deployment.md.\n\n'
        b'Gateway component: core.cjs, audio-stream.cjs, services.cjs, telemetry.cjs and new phrase-stream.cjs. Chatterbox component: reviewed HTTP wrapper only. Existing FirstAudio text-chunks.cjs is verified, not replaced. Browser metadata/report code runs from the existing repository when Next restarts; no UI layout or recording code is replaced. The release manifest pins both independent component ZIPs and is bound by the existing signed-proof helper.\n\n')+(root/'docs/voice-functional-corrections-review.md').read_bytes()+b'\n\n'+(root/'docs/incremental-ollama-tts-review.md').read_bytes()
release={'version':1}
for component in ('Gateway','Chatterbox'):
    prefix='gateway/' if component=='Gateway' else 'optional-chatterbox/'
    if component=='Gateway':
        entries=[(name,root/'gateway'/name,physical/name,original) for name,original in originals.items()]
    else:
        entries=[('chatterbox_voice_server.py',root/'gateway/reviewed-chatterbox/chatterbox_voice_server.py',Path(r'C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py'),'F43E647D0B32C88D45E61E6A9E46CF9F407281E027D11EE0D0A894758D85A234')]
    payload={};manifest=[]
    for name,source,target,original in entries:
        if original:
            if digest(target.read_bytes())!=original:raise SystemExit('Original changed: '+name)
        elif target.exists():raise SystemExit('New helper unexpectedly exists')
        data=source.read_bytes();path=prefix+name;payload[path]=data
        manifest.append(dict(path=path,sha256=digest(data),originalSHA256=original))
    payload['DEPENDENCIES.json']=json.dumps({'firstAudioTextChunksSHA256':first_audio},indent=2).encode()
    payload['REVIEW.md']=review
    for name in ('DEPENDENCIES.json','REVIEW.md'):manifest.append(dict(path=name,sha256=digest(payload[name])))
    payload['SHA256SUMS.json']=json.dumps(manifest,indent=2).encode()
    name=f'Shahvex-Voice-Streaming-{component}-v1.zip'
    output=root/'dist'/name
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(payload):
            info=zipfile.ZipInfo(path,date_time=(2026,11,2,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,payload[path])
    with zipfile.ZipFile(output) as archive:
        if sorted(archive.namelist())!=sorted(payload) or archive.testzip():raise SystemExit('Archive verification failed')
        for entry in manifest:
            if digest(archive.read(entry['path']))!=entry['sha256']:raise SystemExit('Payload hash mismatch')
    release[component]={'file':name,'sha256':digest(output.read_bytes())}
output=root/'dist/Shahvex-Voice-Streaming-Release-v1.json'
output.write_bytes(json.dumps(release,indent=2).encode())
print(json.dumps(release,indent=2));print('RELEASE SHA256 '+digest(output.read_bytes()))
