import fetch from 'node-fetch'

async function callConsume(target) {
  const res = await fetch(process.env.CONSUME_PREKEY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_user_id: target }) })
  return res.json()
}

async function main(){
  const target = process.env.TEST_TARGET_USER
  const promises = []
  for(let i=0;i<10;i++) promises.push(callConsume(target))
  const results = await Promise.all(promises)
  console.log(results)
}

main().catch(e=>{ console.error(e); process.exit(1) })
