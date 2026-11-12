"""Experimental exact-input guarded causal reference cache. Not auto-enabled.

All ten diffusion steps still run. Only whole causal reference chunks whose
inputs match a previous call reuse attention keys/values and block outputs.
The target speech, final non-streaming decode and mismatching inputs stay native.
"""
from types import MethodType


def configure_reference_cache(native, reference_frames):
    import torch
    import torch.nn.functional as functional
    from x_transformers.x_transformers import apply_rotary_pos_emb
    estimator = native.flow.decoder.estimator
    prefix = ((reference_frames - 8) // estimator.static_chunk_size) * estimator.static_chunk_size
    if prefix <= 0 or getattr(estimator, '_shahvex_reference_cache', False):
        return
    original = estimator.forward
    entries = {}
    context = {}
    stats = {'hits': 0, 'misses': 0, 'prefixFrames': prefix}

    def install_block(block, index):
        original_block = block.forward
        def forward(self, x, t, mask=None, rope=None):
            entry = context.get('entry')
            if entry is None or rope is None or rope[1] is not None:
                return original_block(x, t, mask=mask, rope=rope)
            if index not in entry['blocks']:
                output = original_block(x, t, mask=mask, rope=rope)
                norm = self.attn_norm(x[:, :prefix], emb=t)[0]
                key = apply_rotary_pos_emb(self.attn.to_k(norm), rope[0][:prefix], 1.0)
                value = self.attn.to_v(norm)
                entry['blocks'][index] = (output[:, :prefix].clone(), key, value)
                return output
            saved_output, saved_key, saved_value = entry['blocks'][index]
            x = x[:, prefix:]
            norm, gate_msa, shift_mlp, scale_mlp, gate_mlp = self.attn_norm(x, emb=t)
            attn = self.attn
            query = apply_rotary_pos_emb(attn.to_q(norm), rope[0][prefix:], 1.0)
            key = apply_rotary_pos_emb(attn.to_k(norm), rope[0][prefix:], 1.0)
            key = torch.cat((saved_key, key), dim=1)
            value = torch.cat((saved_value, attn.to_v(norm)), dim=1)
            batch = x.shape[0]
            head_dim = attn.inner_dim // attn.heads
            query = query.view(batch, -1, attn.heads, head_dim).transpose(1, 2)
            key = key.view(batch, -1, attn.heads, head_dim).transpose(1, 2)
            value = value.view(batch, -1, attn.heads, head_dim).transpose(1, 2)
            attended = functional.scaled_dot_product_attention(query, key, value, attn_mask=mask[:, :, prefix:, :], dropout_p=0.0, is_causal=False)
            attended = attended.transpose(1, 2).reshape(batch, -1, attn.inner_dim).to(query.dtype)
            attended = attn.to_out[1](attn.to_out[0](attended))
            attended = attended.masked_fill(~mask[:, 0, -1, prefix:].unsqueeze(-1), 0.0)
            x = x + gate_msa.unsqueeze(1) * attended
            ff_norm = self.ff_norm(x) * (1 + scale_mlp[:, None]) + shift_mlp[:, None]
            x = x + gate_mlp.unsqueeze(1) * self.ff(ff_norm)
            return torch.cat((saved_output, x), dim=1)
        block.forward = MethodType(forward, block)

    for index, block in enumerate(estimator.transformer_blocks):
        install_block(block, index)

    def forward(self, x, mask, mu, t, spks=None, cond=None, streaming=False):
        if not streaming or x.shape[-1] <= prefix:
            return original(x, mask, mu, t, spks=spks, cond=cond, streaming=streaming)
        key = tuple(t.detach().cpu().reshape(-1).tolist())
        inputs = (x[:, :, :prefix], mu[:, :, :prefix], cond[:, :, :prefix], spks, mask[:, :, :prefix])
        entry = entries.get(key)
        if entry is None or any(not torch.equal(a, b) for a, b in zip(inputs, entry['inputs'])):
            entry = {'inputs': tuple(value.clone() for value in inputs), 'blocks': {}}
            entries[key] = entry
            stats['misses'] += 1
        else:
            stats['hits'] += 1
        context['entry'] = entry
        try:
            output = original(x, mask, mu, t, spks=spks, cond=cond, streaming=streaming)
            if 'output_prefix' in entry:
                output[:, :, :prefix] = entry['output_prefix']
            else:
                entry['output_prefix'] = output[:, :, :prefix].clone()
            return output
        finally:
            context.clear()

    estimator.forward = MethodType(forward, estimator)
    estimator._shahvex_reference_cache = True
    estimator._shahvex_reference_stats = stats
