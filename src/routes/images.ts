import { Router, raw } from 'express';
import { authenticatedUser, sessionToken } from '../auth/session.js';
import { loadImage, saveImage } from '../images/service.js';

export const imagesRouter = Router();

imagesRouter.post(
  '/',
  raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1mb' }),
  async (request, response) => {
    const uploaded = await saveImage(
      sessionToken(request), request.body, request.headers['content-type'], request.header('X-Image-Purpose')
    );
    response.status(201).json({ imagem: uploaded });
  }
);

imagesRouter.get('/:id', async (request, response) => {
  const user = request.headers.authorization ? (await authenticatedUser(request)).user : null;
  const image = await loadImage(request.params.id, user);
  response.set('Cache-Control', user ? 'private, no-store' : 'public, max-age=300');
  response.set('X-Content-Type-Options', 'nosniff');
  response.type(image.mimeType).send(image.content);
});
