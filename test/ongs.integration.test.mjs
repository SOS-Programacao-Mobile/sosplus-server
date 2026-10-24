import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function validCnpj(base) {
  const digit = (value) => {
    const sum = [...value].reverse().reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * (index % 8 + 2), 0);
    const rest = sum % 11;
    return String(rest < 2 ? 0 : 11 - rest);
  };
  const first = digit(base);
  return base + first + digit(base + first);
}

test('catálogo, perfil público, categorias e sede exclusiva por ONG', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ app }, { database, closeDatabase }, { runMigrations }] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix = randomBytes(6).toString('hex');
  const emails = [`ong-a-${suffix}@example.test`, `ong-b-${suffix}@example.test`, `doador-${suffix}@example.test`];
  const categoryIds = [];
  const register = async (index, type) => {
    const body = {
      tipo: type, nome: `Organização ${index}-${suffix}`, email: emails[index], senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123',
      ...(type === 'ONG' ? { cnpj: validCnpj(randomBytes(6).toString('hex').toUpperCase()) } : {})
    };
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await login.json();
    assert.equal(login.status, 200);
    return result;
  };
  const call = async (path, token, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    const [categoryA] = await database.execute('INSERT INTO categorias (nome) VALUES (?)', [`Categoria A ${suffix}`]);
    const [categoryB] = await database.execute('INSERT INTO categorias (nome) VALUES (?)', [`Categoria B ${suffix}`]);
    const reference = await call('/categorias', null);
    assert.equal(reference.status, 200);
    assert.ok(reference.body.resultados.some((item) => item.id === String(categoryB.insertId)));
    categoryIds.push(categoryA.insertId, categoryB.insertId);
    const ongA = await register(0, 'ONG');
    const ongB = await register(1, 'ONG');
    const donor = await register(2, 'DOADOR');
    assert.equal((await call('/ongs/perfil', donor.token)).status, 403);
    const before = await call('/ongs/perfil', ongA.token);
    assert.equal(before.status, 200, 'Rota estática /perfil não deve ser tratada como ID');
    assert.equal(before.body.ong.endereco, null);

    const profileInput = {
      descricao: 'Descrição institucional', anoFundacao: 2001, telefone: '2222222222',
      site: 'https://ong.example.test', instagram: '@ong', chavePix: 'chave-informativa',
      categoriaIds: categoryIds.map(String)
    };
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
    const upload = await fetch(`${base}/imagens`, { method: 'POST', headers: {
      Authorization: `Bearer ${ongA.token}`, 'Content-Type': 'image/jpeg', 'X-Image-Purpose': 'PERFIL_ONG'
    }, body: imageBytes });
    const imageId = (await upload.json()).imagem.id;
    const savedProfile = await call('/ongs/perfil', ongA.token, 'PUT', { ...profileInput, fotoPerfil: imageId });
    assert.equal(savedProfile.status, 200);
    assert.equal(savedProfile.body.ong.fotoPerfil, String(imageId));
    assert.equal((await fetch(`${base}/imagens/${imageId}`)).status, 200, 'Imagem do perfil fica pública depois de salvar');
    const wrongImage = await fetch(`${base}/imagens`, { method: 'POST', headers: {
      Authorization: `Bearer ${ongB.token}`, 'Content-Type': 'image/jpeg', 'X-Image-Purpose': 'PERFIL_ONG'
    }, body: imageBytes });
    const wrongImageId = (await wrongImage.json()).imagem.id;
    assert.equal((await call('/ongs/perfil', ongA.token, 'PUT', { ...profileInput, fotoPerfil: String(wrongImageId) })).status, 404);
    assert.equal((await call('/ongs/perfil', ongA.token)).body.ong.fotoPerfil, String(imageId), 'Falha não substitui a imagem anterior');
    assert.equal((await call('/ongs/perfil', ongA.token, 'PUT', { ...profileInput, categoriaIds: ['999999999'] })).status, 400);
    const [categoryCount] = await database.execute('SELECT COUNT(*) total FROM ong_categorias WHERE ong_id = ?', [before.body.ong.id]);
    assert.equal(Number(categoryCount[0].total), 2, 'Categoria inválida não remove associações anteriores');

    const address = { cep: '28610-000', logradouro: 'Rua das Flores', numero: '10', complemento: 'Casa 2', bairro: 'Centro', cidade: 'Nova Friburgo', estado: 'RJ' };
    assert.equal((await call('/ongs/endereco', ongA.token, 'PUT', address)).status, 200);
    const savedAddress = await call('/ongs/endereco', ongA.token);
    assert.equal(savedAddress.body.endereco.complemento, 'Casa 2');
    assert.equal(savedAddress.body.endereco.latitude, null);
    assert.equal((await call('/ongs/mapa', null)).body.ongs.some((ong) => ong.id === before.body.ong.id), false);
    await call('/ongs/endereco', ongA.token, 'PUT', { ...address, latitude: -22.2, longitude: -42.5 });
    const mapResults = await call('/ongs/mapa', null);
    const mapOng = mapResults.body.ongs.find((ong) => ong.id === before.body.ong.id);
    assert.deepEqual(mapOng.categorias.map((item) => item.id).sort(), categoryIds.map(String).sort());
    assert.equal(mapOng.latitude, -22.2);
    assert.equal(mapOng.longitude, -42.5);
    assert.equal((await call('/ongs/endereco', ongA.token, 'PUT', { ...address, latitude: -22.2 })).status, 400);
    assert.equal((await call('/ongs/endereco', ongA.token, 'PUT', { ...address, latitude: -22.2, longitude: -181 })).status, 400);
    const [addressCount] = await database.execute('SELECT COUNT(*) total FROM enderecos_ong WHERE ong_id = ?', [before.body.ong.id]);
    assert.equal(Number(addressCount[0].total), 1);

    const [campaign] = await database.execute(`
      INSERT INTO campanhas (ong_id, categoria_id, titulo, descricao, meta_valor, data_inicio, data_fim, status)
      VALUES (?, ?, 'Campanha pública', 'Descrição', 50.00, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'ATIVA')`,
    [before.body.ong.id, categoryIds[0]]);
    const catalog = await call('/ongs?limit=1', null);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.resultados.length, 1);
    assert.ok(catalog.body.continuacao);
    const filtered = await call(`/ongs?categoriaId=${categoryIds[1]}`, null);
    assert.equal(filtered.body.resultados.length, 1);
    assert.equal(filtered.body.resultados[0].id, before.body.ong.id);
    const publicProfile = await call(`/ongs/${before.body.ong.id}`, null);
    assert.equal(publicProfile.status, 200);
    assert.deepEqual(publicProfile.body.ong.categorias.map((item) => item.id).sort(), categoryIds.map(String).sort());
    assert.equal(publicProfile.body.ong.campanhas[0].id, String(campaign.insertId));
    for (const privateField of ['email', 'cnpj', 'senha_hash', 'cpf_cifrado']) assert.equal(privateField in publicProfile.body.ong, false);

    const ongBProfile = await call('/ongs/perfil', ongB.token);
    await database.execute('UPDATE usuarios SET ativo = 0 WHERE id = ?', [ongB.usuario.id]);
    assert.equal((await call(`/ongs/${ongBProfile.body.ong.id}`, null)).status, 404);
  } finally {
    await database.execute('DELETE FROM usuarios WHERE email IN (?, ?, ?)', emails);
    if (categoryIds.length) await database.execute(`DELETE FROM categorias WHERE id IN (${categoryIds.map(() => '?').join(',')})`, categoryIds);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
