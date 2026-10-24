import type { Migration } from './types.js';
import { createUsuarios } from './001-create-usuarios.js';
import { alignUsuariosComMer } from './002-align-usuarios-com-mer.js';
import { createCategorias } from './003-create-categorias.js';
import { createPerfisDoador } from './004-create-perfis-doador.js';
import { createPerfisOng } from './005-create-perfis-ong.js';
import { createOngCategorias } from './006-create-ong-categorias.js';
import { createEnderecosOng } from './007-create-enderecos-ong.js';
import { createSeguidoresOng } from './008-create-seguidores-ong.js';
import { createCampanhas } from './009-create-campanhas.js';
import { createNecessidades } from './010-create-necessidades.js';
import { createDoacoes } from './011-create-doacoes.js';
import { createDoacoesItens } from './012-create-doacoes-itens.js';
import { createPublicacoes } from './013-create-publicacoes.js';
import { optionalCpfDoador } from './014-optional-cpf-doador.js';
import { createSessoes } from './015-create-sessoes.js';
import { createLocalizacoesUsuario } from './016-create-localizacoes-usuario.js';
import { createFotosPerfil } from './017-create-fotos-perfil.js';
import { createDadosPessoaisUsuario } from './018-create-dados-pessoais-usuario.js';
import { protectDoadorCpfIndex } from './019-protect-doador-cpf-index.js';
import { createLocalImages } from './020-create-local-images.js';
import { singleOngAddress } from './021-single-ong-address.js';
import { campaignPublicationMeta } from './022-campaign-publication-meta.js';
import { simulatedWalletIdempotency } from './023-simulated-wallet-idempotency.js';
import { passwordRecovery } from './024-password-recovery.js';

export const migrations: Migration[] = [
  createUsuarios,
  alignUsuariosComMer,
  createCategorias,
  createPerfisDoador,
  createPerfisOng,
  createOngCategorias,
  createEnderecosOng,
  createSeguidoresOng,
  createCampanhas,
  createNecessidades,
  createDoacoes,
  createDoacoesItens,
  createPublicacoes,
  optionalCpfDoador,
  createSessoes,
  createLocalizacoesUsuario,
  createFotosPerfil,
  createDadosPessoaisUsuario,
  protectDoadorCpfIndex,
  createLocalImages,
  singleOngAddress,
  campaignPublicationMeta,
  simulatedWalletIdempotency,
  passwordRecovery
];

const migrationIds = migrations.map((migration) => migration.id);

if (new Set(migrationIds).size !== migrationIds.length) {
  throw new Error('Existem IDs de migração duplicados.');
}
