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
  const userB = process.env.TEST_USER2_ID
  const tokenA = makeToken(userA)
  // userA sends friend request
  const res = await fetch(API_BASE + '/friend-action', { method: 'POST', headers: { 'Authorization': 'Bearer '+tokenA, 'Content-Type': 'application/json' }, body: JSON.stringify({ requester_id: userA, addressee_id: userB, action: 'request' }) })
  console.log('friend request status', res.status)
}

main().catch(e=>{ console.error(e); process.exit(1) })
