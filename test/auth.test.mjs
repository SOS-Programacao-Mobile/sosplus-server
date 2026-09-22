import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordUpdate, validatePersonalData, validateProfilePhoto, validateRegistration, validateUserLocation, validCnpj, validCpf } from '../dist/auth/validation.js';
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

test('localização exige cidade, estado e coordenadas válidas', () => {
  const localizacao = validateUserLocation({ cidade: ' Nova Friburgo ', estado: 'RJ', latitude: -22.2819, longitude: -42.5311 });
  assert.deepEqual(localizacao, { cidade: 'Nova Friburgo', estado: 'RJ', latitude: -22.2819, longitude: -42.5311 });
  for (const body of [
    { cidade: '', estado: 'RJ', latitude: 0, longitude: 0 },
    { cidade: 'Nova Friburgo', estado: '', latitude: 0, longitude: 0 },
    { cidade: 'Nova Friburgo', estado: 'RJ', latitude: -91, longitude: 0 },
    { cidade: 'Nova Friburgo', estado: 'RJ', latitude: 0, longitude: 181 }
  ]) assert.throws(() => validateUserLocation(body), { status: 400 });
});

test('foto de perfil aceita imagem válida e rejeita conteúdo incompatível', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  assert.equal(validateProfilePhoto(jpeg, 'image/jpeg').mimeType, 'image/jpeg');
  assert.throws(() => validateProfilePhoto(Buffer.from('texto'), 'image/jpeg'), { status: 400 });
  assert.throws(() => validateProfilePhoto(jpeg, 'text/plain'), { status: 400 });
  assert.throws(() => validateProfilePhoto(Buffer.alloc(0), 'image/png'), { status: 400 });
});

test('redefinição de senha exige confirmação e senha nova diferente', () => {
  assert.deepEqual(
    validatePasswordUpdate({ senhaAtual: 'senha-atual', novaSenha: 'senha-nova-123', confirmacaoSenha: 'senha-nova-123' }),
    { senhaAtual: 'senha-atual', novaSenha: 'senha-nova-123' }
  );
  assert.throws(() => validatePasswordUpdate({ senhaAtual: '12345678', novaSenha: '12345678', confirmacaoSenha: '12345678' }), { status: 400 });
  assert.throws(() => validatePasswordUpdate({ senhaAtual: 'senha-atual', novaSenha: 'senha-nova-123', confirmacaoSenha: 'outra-senha' }), { status: 400 });
});

test('dados pessoais normalizam CPF e telefone e validam campos sensíveis', () => {
  assert.ok(validCpf('529.982.247-25'));
  assert.equal(validCpf('111.111.111-11'), false);
  assert.deepEqual(validatePersonalData({
    nome: ' Ana ', sobrenome: ' Souza ', cpf: '529.982.247-25', dataNascimento: '1990-05-20',
    endereco: ' Rua Exemplo, 10 ', tipoSanguineo: 'O+', genero: 'FEMININO', telefone: '(22) 99999-0000'
  }), {
    nome: 'Ana', sobrenome: 'Souza', cpf: '52998224725', dataNascimento: '1990-05-20',
    endereco: 'Rua Exemplo, 10', tipoSanguineo: 'O+', genero: 'FEMININO', telefone: '22999990000'
  });
  assert.throws(() => validatePersonalData({ nome: 'Ana', cpf: '123' }), { status: 400 });
  assert.throws(() => validatePersonalData({ nome: 'Ana', dataNascimento: '2035-01-01' }), { status: 400 });
  assert.throws(() => validatePersonalData({ nome: 'Ana', tipoSanguineo: 'X+' }), { status: 400 });
  assert.throws(() => validatePersonalData({ nome: 'Ana', genero: 'QUALQUER' }), { status: 400 });
});

test('dados pessoais são cifrados com autenticação de usuário e campo', async () => {
  process.env.MYSQL_DATABASE = 'sosplus_unit_test';
  process.env.MYSQL_USER = 'unit_test';
  process.env.MYSQL_PASSWORD = 'unit_test';
  process.env.PERSONAL_DATA_ENCRYPTION_KEY = 'f1'.repeat(32);
  const { encryptPersonalData, decryptPersonalData } = await import('../dist/security/personal-data.js');
  const encrypted = encryptPersonalData('42', 'cpf', '52998224725');
  assert.ok(Buffer.isBuffer(encrypted));
  assert.equal(encrypted.includes(Buffer.from('52998224725')), false);
  assert.equal(decryptPersonalData('42', 'cpf', encrypted), '52998224725');
  assert.throws(() => decryptPersonalData('42', 'telefone', encrypted));
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
