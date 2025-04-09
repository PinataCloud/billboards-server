import { PinataSDK } from 'pinata'
import { createClient } from '@supabase/supabase-js'

export const initializeServices = (env: {
  PINATA_JWT: string;
  GATEWAY_URL: string;
  SUPABASE_URL: string;
  SERVICE_KEY: string;
}) => {

  const pinata = new PinataSDK({
    pinataJwt: env.PINATA_JWT,
    pinataGateway: env.GATEWAY_URL
  });

  const supabase = createClient(env.SUPABASE_URL, env.SERVICE_KEY);

  return {
    pinata,
    supabase
  };
};
