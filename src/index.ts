import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { PinataSDK } from 'pinata'
import { initializeServices } from './utils';
import { SupabaseClient } from '@supabase/supabase-js';
import { Board } from './types';
import { createAppClient, viemConnector } from '@farcaster/auth-client';

const appClient = createAppClient({
  relay: 'https://relay.farcaster.xyz',
  ethereum: viemConnector(),
});


interface Bindings {
  PINATA_JWT: string;
  GATEWAY_URL: string;
  SUPABASE_URL: string;
  SERVICE_KEY: string;
}

type Variables = {
  services: {
    pinata: PinataSDK,
    supabase: SupabaseClient
  }
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

app.use(cors())

app.use('*', async (c, next) => {
  const services = initializeServices(c.env)
  c.set('services', services)
  await next()
})

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/presigned_url', async (c) => {

  const body = await c.req.json()

  const { nonce, message, signature } = body

  const { data, success, fid } = await appClient.verifySignInMessage({
    nonce,
    domain: 'billboards.cloud',
    message,
    signature
  });

  if (!success) {
    return c.json({ error: "Unauthorized SIWF" }, { status: 401 })
  }

  const { pinata } = c.get('services')

  const url = await pinata.upload.public.createSignedURL({
    expires: 60 // Last for 60 seconds
  })

  return c.json({ url }, { status: 200 })
})

app.post('/boards', async (c) => {
  const { supabase } = c.get('services')
  const body = await c.req.json()

  const { nonce, message, signature } = body

  const { data, success, fid } = await appClient.verifySignInMessage({
    nonce,
    domain: 'billboards.cloud',
    message,
    signature
  });

  if (!success) {
    return c.json({ error: "Unauthorized SIWF" }, { status: 401 })
  }

  // Insert the board and get its ID
  const { data: boardData, error: boardError } = await supabase
    .from('boards')
    .insert([
      { name: body.boardName, fid, slug: body.slug },
    ])
    .select("id")
    .single()

  if (boardError) {
    return c.json({ error: boardError.message }, { status: 500 })
  }

  // Make sure captions exist, even if empty
  const captions = body.captions || Array(body.imageLinks.length).fill("");

  // Insert all images associated with this board
  const { error: imageError } = await supabase
    .from('board_images')
    .insert(
      body.imageLinks.map((imageUrl: string, index: number) => ({
        board_id: boardData.id,
        image_url: imageUrl,
        fid: body.fid,
        caption: captions[index] || "" // Map each caption to its corresponding image
      }))
    )

  if (imageError) {
    return c.json({ error: imageError.message }, { status: 500 })
  }

  return c.json({ status: "ok" })
})

app.get('/boards', async (c) => {

  const { supabase } = c.get('services')

  const nonce = c.req.header('nonce')
  const message = c.req.header('message')
  const signature = c.req.header('signature')

  if (!nonce || !message || !signature) {
    return c.json({ error: "Missing auth header" }, { status: 500 })
  }

  const { data, success, fid } = await appClient.verifySignInMessage({
    nonce,
    domain: 'billboards.cloud',
    message,
    signature: signature as `0x`
  });

  if (!success) {
    return c.json({ error: "Unauthorized SIWF" }, { status: 401 })
  }

  const { data: boards, error } = await supabase
    .from('boards')
    .select('*, board_images(*)')
    .eq('fid', fid)
    .order('id', { ascending: false })

  if (error) {
    return c.json({ error: error.message }, { status: 500 })
  }

  console.log(boards)

  return c.json(boards)
})

app.get('/board/:slug', async (c) => {
  const { supabase } = c.get('services')

  const slug = c.req.param("slug")

  const { data: board, error } = await supabase
    .from('boards')
    .select('*, board_images(*)')
    .eq('slug', slug)
    .single()

  if (error) {
    return c.json({ error: error.message }, { status: 500 })
  }

  return c.json(board)
})

export default app
