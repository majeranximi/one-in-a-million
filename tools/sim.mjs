// Szybki test bez przeglądarki: autopilot w roli gracza kontra boty, ze stałym krokiem czasu.
import { Track } from '../src/track.js';
import { Race, Racer, DIFFICULTY, makeBotName } from '../src/race.js';

const track = new Track();
console.log('długość toru', track.length.toFixed(0), 'jajo przy', track.eggS.toFixed(0));
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
  console.log(diff, 'średnie miejsce autopilota', mean(places).toFixed(1), 'wygrane', places.filter((p) => p === 1).length, '/', RUNS,
    'średni czas', mean(times).toFixed(1), 's', 'NaN', bad, 'bez zwycięzcy', timeouts);
}
