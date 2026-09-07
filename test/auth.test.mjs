import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, validCnpj } from '../dist/auth/validation.js';
import { hashPassword, verifyPassword } from '../dist/auth/password.js';

test('campos obrigatórios, confirmação, e-mail e CNPJ para cada tipo', () => {
  for (const tipo of ['DOADOR', 'ONG']) {
    const input = { tipo, nome: 'Pessoa ou ONG', email: 'contato@example.com', senha: 'senha1234', confirmacaoSenha: 'senha1234', cnpj: '11.222.333/0001-81' };
    for (const field of ['nome', 'email', 'senha', 'confirmacaoSenha', ...(tipo === 'ONG' ? ['cnpj'] : [])]) {
      assert.throws(() => validateRegistration({ ...input, [field]: ' ' }), { status: 400 });
    }
    assert.throws(() => validateRegistration({ ...input, confirmacaoSenha: 'outrasenha' }), { status: 400 });
    assert.throws(() => validateRegistration({ ...input, email: 'invalido' }), { status: 400 });
    assert.throws(() => validateRegistration({ ...input, senha: '123', confirmacaoSenha: '123' }), { status: 400 });
    assert.equal(validateRegistration({ ...input, email: ' CONTATO@EXAMPLE.COM ' }).email, 'contato@example.com');
  }
  for (const value of [null, [], {}, { tipo: 'ADMIN' }, { nome: 42 }]) assert.throws(() => validateRegistration(value), { status: 400 });
});

test('CNPJ numérico e alfanumérico com dígitos verificadores', () => {
  assert.ok(validCnpj('11.222.333/0001-81'));
  assert.ok(validCnpj('00.000.000/E08G-12'));
  for (const value of ['', '00000000000000', '11222333000180', '11222333000181!']) assert.equal(validCnpj(value), false);
});

test('hash com salt não guarda senha em texto e verifica senha exata', async () => {
  const first = await hashPassword('senha de teste');
  const second = await hashPassword('senha de teste');
  assert.notEqual(first, second);
  assert.equal(first.includes('senha de teste'), false);
  assert.equal(await verifyPassword('senha de teste', first), true);
  assert.equal(await verifyPassword('senha de teste ', first), false);
  assert.equal(await verifyPassword('senha de teste', '1234'), false);
});
