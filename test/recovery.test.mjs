import test from 'node:test';
import assert from 'node:assert/strict';

test('recuperação exige e-mail, código completo e confirmação de senha', async () => {
  const { validateRecoveryRequest, validateRecoveryConfirmation } = await import('../dist/auth/recovery.js');
  assert.equal(validateRecoveryRequest({ email: '  Conta@Example.test ' }).email, 'conta@example.test');
  const body = { email: 'conta@example.test', codigo: 'ab'.repeat(32), novaSenha: 'Senha-segura-123', confirmacaoSenha: 'Senha-segura-123' };
  assert.equal(validateRecoveryConfirmation(body).code.length, 64);
  for (const invalid of [{ ...body, codigo: '123456' }, { ...body, confirmacaoSenha: 'Outra' }, { ...body, novaSenha: 'curta' }, { ...body, email: 'sem-email' }]) assert.throws(() => validateRecoveryConfirmation(invalid));
});
