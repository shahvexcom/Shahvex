# Future Railway migration — plan only

Do not deploy or run tunnel setup now. Current same-machine local testing uses 127.0.0.1:8787, documented in [local-backend-connection.md](local-backend-connection.md).

When ready to move the backend, first confirm Railway's then-current deployment/network capabilities, persistent connection lifecycle, private routing and secret configuration against its official documentation. This plan does not assume Railway containers accept inbound SSH or that a remote VM's loopback is reachable from Railway.

Select and validate an authenticated private network between the Railway backend and physical PC, or an approved persistent bridge with restricted SSH reverse forwarding. In the latter design, physical PC → SSH bridge terminates gateway forwarding on bridge loopback; an additional authenticated private route/proxy must connect Railway to that bridge. Pointing Railway at `127.0.0.1:18787` alone would point to Railway itself and would fail.

Keep all physical engine/model listeners loopback. Never expose Ollama/Whisper/Chatterbox publicly. Forward only the authenticated gateway over the encrypted private transport. The current backend client deliberately accepts only loopback HTTP: a private non-loopback HTTPS endpoint would require reviewed TLS/client-auth support or a colocated tunnel sidecar presenting loopback. Do not weaken `localUrl` validation to use a public HTTP address.

Provision the gateway credential only as a backend secret, preserve scoped per-call tokens, and retain request deadlines/admission limits. Plan tunnel reconnection, idle expiry, backend restarts and failed cleanup before cutover. First repeat the exported-agent isolation, audio and cancellation rehearsal from Railway over the selected private route. Then verify frontend-to-backend application authentication separately; Vercel UI must never receive the gateway service token or call physical localhost.

No runtime changes, deployments, SSH servers or private-network providers are selected or installed by this planning update. VICIdial media details and real concurrency/load tests remain independent gates.
