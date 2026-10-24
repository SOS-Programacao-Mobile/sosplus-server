import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function validCnpj(seed) {
  const number = (value, weights) => {
    const sum = [...value].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const base = `${seed.padStart(8, '0').slice(0, 8)}0000`;
  const first = number(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${first}${number(base + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

test('campanhas persistidas respeitam propriedade, período, status e catálogo regional paginado', {
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
  const emails = [`campaign-ong-${suffix}@example.test`, `campaign-other-${suffix}@example.test`, `campaign-donor-${suffix}@example.test`];
  const register = async (email, type, cnpj) => {
    const body = { tipo: type, nome: `Conta ${suffix}`, email, senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123', ...(cnpj ? { cnpj } : {}) };
    const created = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return login.json();
  };
  const call = async (path, token, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    const [category] = await database.execute('INSERT INTO categorias (nome) VALUES (?)', [`Campanha ${suffix}`]);
    const cnpjSeed = () => randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(-8);
    const ong = await register(emails[0], 'ONG', validCnpj(cnpjSeed()));
    const other = await register(emails[1], 'ONG', validCnpj(cnpjSeed()));
    const donor = await register(emails[2], 'DOADOR');
    const uploadImage = async () => {
      const response = await fetch(`${base}/imagens`, { method:'POST',headers:{ Authorization:`Bearer ${ong.token}`,'Content-Type':'image/jpeg','X-Image-Purpose':'CAMPANHA' },body:Buffer.from([0xff,0xd8,0xff,0xdb,0x00]) });
      assert.equal(response.status,201);return (await response.json()).imagem.id;
    };
    const originalImage = await uploadImage();
    const input = { categoriaId: String(category.insertId), titulo: 'Campanha real', descricao: 'Descrição persistida', metaCentavos: 0,
      inicioEm: new Date().toISOString().slice(0, 10), fimEm: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) };
    assert.equal((await call('/campanhas', donor.token, 'POST', input)).status, 403);
    assert.equal((await call('/campanhas', ong.token, 'POST', { ...input, fimEm: '2026-02-30' })).status, 400);
    const draft = await call('/campanhas', ong.token, 'POST', { ...input, imagemId: originalImage });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.campanha.status, 'RASCUNHO');
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, other.token)).status, 404);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, null)).status, 404);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}/status`, ong.token, 'PATCH', { status: 'ATIVA' })).status, 400);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, ong.token, 'PUT', { ...input, titulo: 'Atualizada', metaCentavos: 10_000, imagemId: originalImage })).status, 200);
    const replacementImage = await uploadImage();
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, ong.token, 'PUT', { ...input, titulo: 'Atualizada', metaCentavos: 10_000, imagemId: replacementImage })).status, 200);
    const published = await call(`/campanhas/${draft.body.campanha.id}/status`, ong.token, 'PATCH', { status: 'ATIVA' });
    assert.equal(published.status, 200);
    assert.equal(published.body.campanha.status, 'ATIVA');
    assert.equal((await fetch(`${base}/imagens/${replacementImage}`)).status,200);
    assert.equal((await fetch(`${base}/imagens/${originalImage}`)).status,404,'Imagem descartada no rascunho não se torna pública');
    const ongProfile = await call(`/ongs/${draft.body.campanha.ongId}`, null);
    assert.equal(ongProfile.body.ong.campanhas.find((item)=>item.id===draft.body.campanha.id).imagemId,replacementImage);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, null)).body.campanha.titulo, 'Atualizada');
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}`, donor.token, 'PUT', input)).status, 403);
    const mine = await call('/campanhas/minhas?status=ATIVA', ong.token);
    assert.equal(mine.body.resultados[0].id, draft.body.campanha.id);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}/status`, ong.token, 'PATCH', { status: 'ENCERRADA' })).status, 200);
    assert.equal((await call(`/campanhas/${draft.body.campanha.id}/status`, ong.token, 'PATCH', { status: 'ATIVA' })).status, 409);
    const catalog = await call('/campanhas?limite=1', null);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.resultados[0].status, 'ENCERRADA');
    assert.equal((await call('/campanhas?continuacao=bad-cursor', null)).status, 400);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const future = new Date(`${today}T12:00:00-03:00`);
    future.setDate(future.getDate() + 10);
    const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(future);
    const [ongAProfile] = await database.execute('SELECT id FROM perfis_ong WHERE usuario_id = ?', [ong.usuario.id]);
    const [ongBProfile] = await database.execute('SELECT id FROM perfis_ong WHERE usuario_id = ?', [other.usuario.id]);
    const regionalCity = `Cidade de teste ${suffix}`;
    const addressValues = ['28610-000', 'Rua A', '1', null, 'Centro', regionalCity, 'RJ', null, null];
    await database.execute(`INSERT INTO enderecos_ong (cep,logradouro,numero,complemento,bairro,cidade,estado,latitude,longitude,ong_id) VALUES (?,?,?,?,?,?,?,?,?,?)`, [...addressValues, ongAProfile[0].id]);
    await database.execute(`INSERT INTO enderecos_ong (cep,logradouro,numero,complemento,bairro,cidade,estado,latitude,longitude,ong_id) VALUES (?,?,?,?,?,?,?,?,?,?)`, ['01000-000', 'Rua B', '2', null, 'Centro', 'São Paulo', 'SP', null, null, ongBProfile[0].id]);
    const localDraft = await call('/campanhas', ong.token, 'POST', { ...input, metaCentavos: 5000, inicioEm: today, fimEm: endDate, titulo: 'Prioridade local' });
    const remoteDraft = await call('/campanhas', other.token, 'POST', { ...input, metaCentavos: 7000, inicioEm: today, fimEm: endDate, titulo: 'Outra cidade' });
    assert.equal((await call(`/campanhas/${localDraft.body.campanha.id}/status`, ong.token, 'PATCH', { status: 'ATIVA' })).status, 200);
    assert.equal((await call(`/campanhas/${remoteDraft.body.campanha.id}/status`, other.token, 'PATCH', { status: 'ATIVA' })).status, 200);
    const localPage = await call(`/campanhas?status=ATIVA&limite=1&cidade=${encodeURIComponent(regionalCity)}&estado=RJ`, null);
    assert.equal(localPage.body.resultados[0].id, localDraft.body.campanha.id);
    assert.ok(localPage.body.continuacao);
    const nextPage = await call(`/campanhas?status=ATIVA&limite=1&cidade=${encodeURIComponent(regionalCity)}&estado=RJ&continuacao=${encodeURIComponent(localPage.body.continuacao)}`, null);
    assert.equal(nextPage.body.resultados[0].id, remoteDraft.body.campanha.id);
  } finally {
    await database.execute('DELETE FROM usuarios WHERE email IN (?, ?, ?)', emails);
    await database.execute('DELETE FROM categorias WHERE nome = ?', [`Campanha ${suffix}`]);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
