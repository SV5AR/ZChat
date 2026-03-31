import fetch from 'node-fetch'
import jwt from 'jsonwebtoken'

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const API_BASE = `https://${PROJECT_REF}.functions.supabase.co`

function makeToken(sub, role='user', jti='test-jti'){
  return jwt.sign({ sub, role }, SUPABASE_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', jwtid: jti })
}

async function main(){
  const userId = process.env.TEST_USER_ID
  const token = makeToken(userId, 'user', 'revoked-jti')
  // assume token 'revoked-jti' is inserted into token_revocations by a setup step
  const res = await fetch(API_BASE + '/ingest-message', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: process.env.TEST_CONV_ID, sender_id: userId, ciphertext_base64: 'AAAA', packet_size: 4096 }) })
  console.log('revoked token insert status', res.status)
}

main().catch(e=>{ console.error(e); process.exit(1) })
