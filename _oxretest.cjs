const { createRequire } = require('module');
const req = createRequire('C:/Users/JH Z/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/index.js');
const yaml = req('yaml');
const fs = require('fs');
const cred = yaml.parse(fs.readFileSync(process.env.USERPROFILE + '/.dsh/.credentials.yaml', 'utf8'));
const key = cred.refs.OPENCODE_GO_API_KEY;
(async function () {
  for (const [name, url, body] of [
    ['chat', 'https://opencode.ai/zen/go/v1/chat/completions', { model: 'ox-alpha-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 }],
  ]) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      console.log(name, '-> HTTP', r.status);
      console.log(t.slice(0, 400));
    } catch (e) { console.log(name, '-> ERR', e.message); }
  }
})();