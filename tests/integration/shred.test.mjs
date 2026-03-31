import fetch from 'node-fetch'
import jwt from 'jsonwebtoken'

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const API_BASE = `https://${PROJECT_REF}.functions.supabase.co`

function makeToken(sub, role='user'){
  return jwt.sign({ sub, role }, SUPABASE_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', jwtid: String(Math.random()) })
}

async function main(){
  const userA = process.env.TEST_USER_ID
  const tokenA = makeToken(userA)
  // Attempt to shred a message (assumes message_id exists in TEST_MESSAGE_ID)
  const res = await fetch(API_BASE + '/shred-message', { method: 'POST', headers: { 'Authorization': 'Bearer '+tokenA, 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: process.env.TEST_MESSAGE_ID, signer_id: userA, signature: process.env.TEST_SIGNATURE }) })
  console.log('shred status', res.status)
}

main().catch(e=>{ console.error(e); process.exit(1) })
