// Quick test without a browser: autopilot as the player against bots, with a fixed time step.
import { Track } from '../src/track.js';
import { Race, Racer, DIFFICULTY, makeBotName } from '../src/race.js';

const track = new Track();
console.log('track length', track.length.toFixed(0), 'egg at', track.eggS.toFixed(0));
const RUNS = 30;
for (const diff of ['easy', 'normal', 'hard']) {
  const places = [], times = [];
  let bad = 0, timeouts = 0;
  for (let run = 0; run < RUNS; run++) {
    const race = new Race(track, {});
    const racers = [new Racer(0, 'Ty', true)];
    racers[0].autopilot = true;
    for (let i = 0; i < 11; i++) racers.push(new Racer(i + 1, makeBotName(i), false));
    race.setup({ racers, difficulty: DIFFICULTY[diff] });
    race.go();
    while (!race.winner && race.time < 400) {
      race.update(1 / 60);
      for (const r of racers) if (!Number.isFinite(r.s + r.x + r.y + r.vs + r.vx + r.vy)) bad++;
    }
    if (!race.winner) timeouts++;
    places.push(race.ranking().indexOf(racers[0]) + 1);
    times.push(race.time);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(diff, 'autopilot average place', mean(places).toFixed(1), 'wins', places.filter((p) => p === 1).length, '/', RUNS,
    'average time', mean(times).toFixed(1), 's', 'NaN', bad, 'no winner', timeouts);
}
