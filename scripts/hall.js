// Regenerates hall.json — the Hall of Corpses leaderboard.
// Runs weekly via .github/workflows/hall.yml; also runnable locally:
//   GH_TOKEN=... node scripts/hall.js
const path = require('path');
const N = require(path.join(__dirname, '..', 'necrometer.js'));

const NAMES = [
  // famous personal accounts
  'torvalds', 'defunkt', 'sindresorhus', 'tj', 'antirez', 'mitchellh',
  'gaearon', 'jashkenas', 'fabpot', 'ruanyf', 'kripken', 'ssloy',
  // orgs known for big footprints
  'google', 'microsoft', 'facebook', 'twitter-archive', 'angular', 'spring-projects',
  // house accounts
  'UberMetroid', 'ImpSync', 'easyLDAP', 'idlescreen', 'openOODA', 'studio2201',
];

(async () => {
  const token = process.env.NECRO_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const hall = [];
  for (const name of NAMES) {
    try {
      const repos = await N.fetchRepos(name, null, token);
      const r = N.analyze(name, repos);
      hall.push({
        name, index: r.index, title: r.title,
        corpses: r.corpses.length, total: r.total, starsStranded: r.starsStranded,
      });
      console.log(`${name}: ${r.index}% (${r.corpses.length}/${r.total} corpses)`);
    } catch (e) {
      console.error(`${name}: skipped — ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  hall.sort((a, b) => b.index - a.index || b.corpses - a.corpses);
  const out = path.join(__dirname, '..', 'hall.json');
  require('fs').writeFileSync(out, JSON.stringify(hall, null, 1) + '\n');
  console.log(`wrote ${out} (${hall.length} entries)`);
})().catch((e) => { console.error(e); process.exit(1); });
