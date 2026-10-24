import type { Request } from 'express';
import { currentUser, type PublicUser } from './service.js';
import { AuthError, type TipoUsuario } from './validation.js';

export function sessionToken(request: Pick<Request, 'headers'>): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AuthError(401, 'Entre na sua conta para continuar.');
  return match[1];
}

export async function authenticatedUser(request: Pick<Request, 'headers'>): Promise<{ token: string; user: PublicUser }> {
  const token = sessionToken(request);
  return { token, user: await currentUser(token) };
}

export function requireUserType(user: PublicUser, type: TipoUsuario): PublicUser {
  if (user.tipo !== type) throw new AuthError(403, 'Esta operação não está disponível para o perfil selecionado.');
  return user;
}
