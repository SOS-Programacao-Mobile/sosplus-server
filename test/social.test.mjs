import test from 'node:test';
import assert from 'node:assert/strict';

test('valida publicações e vínculos opcionais', async () => {
  const { validatePublication } = await import('../dist/social/validation.js');
  assert.deepEqual(validatePublication({ texto: '  Aviso  ' }), { texto: 'Aviso', campaignId: null, imageId: null });
  assert.deepEqual(validatePublication({ texto: 'Evento', campanhaId: '12', imagemId: '8' }), { texto: 'Evento', campaignId: '12', imageId: '8' });
  for (const body of [null, {}, { texto: ' ' }, { texto: 'x'.repeat(10001) }, { texto: 'Ok', campanhaId: 'x' }, { texto: 'Ok', imagemId: 'x' }]) {
    assert.throws(() => validatePublication(body));
  }
});
