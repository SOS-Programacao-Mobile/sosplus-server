import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CENTS, validateBalance, validateDonation } from '../dist/wallet/validation.js';

test('saldo simulado aceita centavos inteiros no limite', () => {
  assert.equal(validateBalance({ saldoCentavos: 0 }), 0);
  assert.equal(validateBalance({ saldoCentavos: MAX_CENTS }), MAX_CENTS);
  for (const saldoCentavos of [-1, 1.1, MAX_CENTS + 1, '100']) {
    assert.throws(() => validateBalance({ saldoCentavos }));
  }
});

test('doação exige valor, anonimato e chave de operação válidos', () => {
  const donation = { campanhaId: '42', valorCentavos: 3000, anonima: true };
  assert.equal(validateDonation(donation, 'operation-key-1').valueCents, 3000);
  assert.throws(() => validateDonation({ ...donation, valorCentavos: 0 }, 'operation-key-1'));
  assert.throws(() => validateDonation(donation, 'short'));
  assert.throws(() => validateDonation({ ...donation, anonima: 'true' }, 'operation-key-1'));
});
