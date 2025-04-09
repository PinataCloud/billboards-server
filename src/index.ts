import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { PinataSDK } from 'pinata'
import { initializeServices } from './utils';
import { SupabaseClient } from '@supabase/supabase-js';
import { Board } from './types';

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

  const { pinata } = c.get('services')

  const url = await pinata.upload.public.createSignedURL({
    expires: 60 // Last for 60 seconds
  })

  return c.json({ url }, { status: 200 })
})

app.post('/boards', async (c) => {

  const { supabase } = c.get('services')
  const body = await c.req.json()

  // Insert the board and get its ID
  const { data: boardData, error: boardError } = await supabase
    .from('boards')
    .insert([
      { name: body.boardName, fid: body.fid, slug: body.slug },
    ])
    .select("id")
    .single()

  if (boardError) {
    return c.json({ error: boardError.message }, { status: 500 })
  }

  // Insert all images associated with this board
  const { error: imageError } = await supabase
    .from('board_images')
    .insert(
      body.imageLinks.map((imageUrl: string) => ({
        board_id: boardData.id,
        image_url: imageUrl,
        fid: body.fid
      }))
    )

  if (imageError) {
    return c.json({ error: imageError.message }, { status: 500 })
  }

  return c.json({ status: "ok" })
})

app.get('/boards/:fid', async (c) => {

  const { supabase } = c.get('services')

  const fid = c.req.param("fid")

  const { data: boards, error } = await supabase
    .from('boards')
    .select('*, board_images(*)')
    .eq('fid', fid)

  if (error) {
    return c.json({ error: error.message }, { status: 500 })
  }

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
