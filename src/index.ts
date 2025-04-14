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
  DOMAIN: string;
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

app.post('/verify', async (c) => {
  const body = await c.req.json();
  const { nonce, message, signature } = body;

  const verifyResult = await appClient.verifySignInMessage({
    nonce,
    domain: c.env.DOMAIN, // Make sure this matches your domain
    message,
    signature
  });

  if (!verifyResult.success) {
    return c.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Return the fid from the verification result
  return c.json({
    status: "ok",
    fid: verifyResult.fid
  });
});

app.post('/presigned_url', async (c) => {

  const body = await c.req.json()

  const { nonce, message, signature } = body

  const { data, success, fid } = await appClient.verifySignInMessage({
    nonce,
    domain: c.env.DOMAIN,
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
    domain: c.env.DOMAIN,
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

app.post('/list-boards', async (c) => {

  const { supabase } = c.get('services')
  const body = await c.req.json()

  const { nonce, message, signature } = body

  const { data, success, fid } = await appClient.verifySignInMessage({
    nonce,
    domain: c.env.DOMAIN,
    message,
    signature
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

app.get('/embed/:slug', async (c) => {
  const { supabase } = c.get('services')
  const slug = c.req.param('slug')

  // Get the board and its images from supabase
  const { data: board, error } = await supabase
    .from('boards')
    .select('*, board_images(*)')
    .eq('slug', slug)
    .single()

  let imageUrl = "https://billboards.cloud/image.png" // Default fallback image

  // If we have board data and it has images, use the first image URL
  if (board && board.board_images && board.board_images.length > 0) {
    imageUrl = board.board_images[0].image_url
  }

  const data = JSON.stringify({
    version: "next",
    imageUrl: imageUrl,
    button: {
      title: "View",
      action: {
        type: "launch_frame",
        url: `https://billboards.cloud/board/${slug}`,
        name: "Billboards",
        splashImageUrl: "https://billboards.cloud/splash.png",
        splashBackgroundColor: "#FEF3C9"
      }
    }
  })
  return c.html(`
    <title>Billboards</title>
    <meta name="description" content="Share images on Farcaster">

    <meta property="og:url" content="https://billboards.cloud">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Billboards">
    <meta property="og:description" content="Share images on Farcaster">
    <meta property="og:image" content="https://billboards.cloud/og.png">

    <meta name="twitter:card" content="summary_large_image">
    <meta property="twitter:domain" content="billboards.cloud">
    <meta property="twitter:url" content="https://billboards.cloud">
    <meta name="twitter:title" content="Billboards">
    <meta name="twitter:description" content="Share images on Farcaster">
    <meta name="twitter:image" content="https://billboards.cloud/og.png">

    <meta name="fc:frame" content='${data}'/>
  `)

})

export default app
