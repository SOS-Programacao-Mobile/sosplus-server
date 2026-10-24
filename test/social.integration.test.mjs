import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function validCnpj(seed) {
  const digit=(value,weights)=>{const total=[...value].reduce((sum,char,index)=>sum+Number(char)*weights[index],0);const mod=total%11;return String(mod<2?0:11-mod)};
  const base=`${seed.padStart(8,'0').slice(0,8)}0000`;const first=digit(base,[5,4,3,2,9,8,7,6,5,4,3,2]);
  return `${base}${first}${digit(base+first,[6,5,4,3,2,9,8,7,6,5,4,3,2])}`;
}
test('seguir, publicações, feed e dashboard permanecem isolados por ONG e doador', { skip: process.env.RUN_AUTH_INTEGRATION !== '1' }, async () => {
  assert.match(process.env.MYSQL_DATABASE??'',/_test$/);
  const [{app},{database,closeDatabase},{runMigrations}]=await Promise.all([import('../dist/app.js'),import('../dist/database/mysql.js'),import('../dist/database/migrations/migrator.js')]);
  await runMigrations();const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix=randomBytes(6).toString('hex');const emails=[`social-a-${suffix}@example.test`,`social-b-${suffix}@example.test`,`social-d-${suffix}@example.test`,`social-other-${suffix}@example.test`];
  const register=async(index,type)=>{const input={tipo:type,nome:`Conta ${suffix}`,email:emails[index],senha:'Teste-seguro-123',confirmacaoSenha:'Teste-seguro-123',...(type==='ONG'?{cnpj:validCnpj(randomBytes(4).readUInt32BE().toString().padStart(8,'0').slice(-8))}:{})};
    const reg=await fetch(`${base}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(reg.status,201);
    return (await (await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).json());};
  const call=async(path,token,method='GET',body)=>{const res=await fetch(`${base}${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:res.status,body:await res.json()};};
  try{
    const [category]=await database.execute('INSERT INTO categorias (nome) VALUES (?)',[`Social ${suffix}`]);
    const [ongA,ongB,donor,otherDonor]=await Promise.all([register(0,'ONG'),register(1,'ONG'),register(2,'DOADOR'),register(3,'DOADOR')]);
    const [profileA]=await database.execute('SELECT id FROM perfis_ong WHERE usuario_id=?',[ongA.usuario.id]);
    const [profileB]=await database.execute('SELECT id FROM perfis_ong WHERE usuario_id=?',[ongB.usuario.id]);
    assert.equal((await call(`/ongs/${profileA[0].id}/seguir`,ongA.token,'POST')).status,403);
    assert.equal((await call(`/ongs/${profileA[0].id}/seguir`,donor.token,'POST')).body.seguindo,true);
    await call(`/ongs/${profileA[0].id}/seguir`,donor.token,'POST');
    assert.equal((await call(`/ongs/${profileA[0].id}`,donor.token)).body.ong.seguindo,true);
    assert.equal((await call(`/ongs/${profileA[0].id}`,donor.token)).body.ong.seguidores,1);
    const bad=await call('/publicacoes',ongA.token,'POST',{texto:'Sem título',campanhaId:'999999'});assert.equal(bad.status,404);
    const publication=(text)=>call('/publicacoes',ongA.token,'POST',{texto:text});
    const pubOld=await publication('Primeira atualização');
    await call(`/ongs/${profileB[0].id}/seguir`,otherDonor.token,'POST');
    await call('/publicacoes',ongB.token,'POST',{texto:'ONG não seguida'});
    const pubNew=await publication('Atualização mais recente');
    assert.equal(pubOld.status,201);assert.equal(pubNew.status,201);
    const feed1=await call('/feed?limite=1',donor.token);assert.equal(feed1.body.resultados[0].id,pubNew.body.publicacao.id);assert.ok(feed1.body.continuacao);
    const feed2=await call(`/feed?limite=1&continuacao=${encodeURIComponent(feed1.body.continuacao)}`,donor.token);assert.equal(feed2.body.resultados[0].id,pubOld.body.publicacao.id);
    assert.equal((await call('/feed',otherDonor.token)).body.resultados.length,1);
    await call(`/ongs/${profileA[0].id}/seguir`,donor.token,'DELETE');await call(`/ongs/${profileA[0].id}/seguir`,donor.token,'DELETE');
    assert.equal((await call('/feed',donor.token)).body.resultados.length,0);
    assert.equal((await call(`/publicacoes/${pubNew.body.publicacao.id}`,otherDonor.token)).body.publicacao.ongId,String(profileA[0].id));

    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
    const later=new Date(`${today}T12:00:00-03:00`);later.setDate(later.getDate()+15);const end=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(later);
    const [active]=await database.execute(`INSERT INTO campanhas (ong_id,categoria_id,titulo,descricao,meta_valor,data_inicio,data_fim,status) VALUES (?,?,?,?,?,?,?,'ATIVA')`,[profileA[0].id,category.insertId,'Ativa','Descrição','100.00',today,end]);
    const [ended]=await database.execute(`INSERT INTO campanhas (ong_id,categoria_id,titulo,descricao,meta_valor,data_inicio,data_fim,status) VALUES (?,?,?,?,?,?,?,'ENCERRADA')`,[profileA[0].id,category.insertId,'Encerrada','Descrição','100.00',today,today]);
    const [otherCampaign]=await database.execute(`INSERT INTO campanhas (ong_id,categoria_id,titulo,descricao,meta_valor,data_inicio,data_fim,status) VALUES (?,?,?,?,?,?,?,'ATIVA')`,[profileB[0].id,category.insertId,'Outra ONG','Descrição','100.00',today,end]);
    assert.equal((await call('/publicacoes',ongA.token,'POST',{texto:'Vínculo alheio',campanhaId:String(otherCampaign.insertId)})).status,404);
    assert.equal((await call('/publicacoes',ongA.token,'POST',{texto:'Vínculo próprio',campanhaId:String(active.insertId)})).status,201);
    const [donorProfile]=await database.execute('SELECT id FROM perfis_doador WHERE usuario_id=?',[donor.usuario.id]);
    await database.execute('INSERT INTO doacoes (doador_id,campanha_id,valor,status) VALUES (?,?,?,?)',[donorProfile[0].id,active.insertId,'30.00','CONFIRMADA']);
    await database.execute('INSERT INTO doacoes (doador_id,campanha_id,valor,status) VALUES (?,?,?,?)',[donorProfile[0].id,active.insertId,'7.00','PENDENTE']);
    const dash=await call('/ongs/dashboard',ongA.token);assert.equal(dash.status,200);assert.equal(dash.body.dashboard.campanhasAtivas,1);
    assert.equal(dash.body.dashboard.campanhasEncerradas,1);assert.equal(dash.body.dashboard.doacoesConfirmadas,1);assert.equal(dash.body.dashboard.arrecadadoCentavos,3000);
    assert.equal((await call('/ongs/dashboard',donor.token)).status,403);
    assert.equal((await call(`/publicacoes/${pubNew.body.publicacao.id}`,otherDonor.token)).status,200);
  }finally{
    await database.execute(`DELETE d FROM doacoes d JOIN campanhas c ON c.id=d.campanha_id JOIN perfis_ong p ON p.id=c.ong_id JOIN usuarios u ON u.id=p.usuario_id WHERE u.email IN (?,?)`,[emails[0],emails[1]]);
    await database.execute('DELETE FROM usuarios WHERE email IN (?,?,?,?)',emails);
    await database.execute('DELETE FROM categorias WHERE nome=?',[`Social ${suffix}`]);
    await new Promise((resolve)=>server.close(resolve));await closeDatabase();
  }
});
