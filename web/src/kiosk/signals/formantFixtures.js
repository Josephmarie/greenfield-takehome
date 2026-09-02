// Synthetic spectra built from real vowel formant frequencies (Peterson &
// Barney, adult male). Building fixtures from formants rather than hand-picked
// band values means the test exercises bandEnergies() for real instead of
// asserting against numbers reverse-engineered from the implementation.

export const FORMANTS = {
  aa: { f: [730, 1090, 2440], voiced: true },   // "hot"
  E:  { f: [530, 1840, 2480], voiced: true },   // "head"
  I:  { f: [270, 2290, 3010], voiced: true },   // "heed"
  O:  { f: [570,  840, 2410], voiced: true },   // "hawed"
  U:  { f: [300,  870, 2240], voiced: true },   // "who'd"
  S:  { f: [],                voiced: false, noise: [4000, 8000] },
  F:  { f: [],                voiced: false, noise: [2500, 7000] },
};

/** Fill a Uint8Array as getByteFrequencyData would for the given phoneme. */
export function synthSpectrum(spec, phoneme, { sampleRate = 48000, fftSize = 1024, f0 = 120 } = {}) {
  const binHz = sampleRate / fftSize;
  const def = FORMANTS[phoneme];
  spec.fill(0);
  for (let i = 0; i < spec.length; i++) {
    const hz = i * binHz;
    let mag = 0;
    if (def.voiced) {
      mag += 0.55 * Math.exp(-Math.pow((hz - f0) / 90, 2));          // f0 energy
      const amps = [1.0, 0.62, 0.34];
      def.f.forEach((F, k) => {
        const bw = 90 + F * 0.09;
        mag += amps[k] * Math.exp(-Math.pow((hz - F) / bw, 2));
      });
      mag *= Math.exp(-hz / 5200);                                    // spectral tilt
    }
    if (def.noise) {
      const [lo, hi] = def.noise;
      if (hz > lo && hz < hi) mag += 0.85 * (0.6 + 0.4 * Math.sin(i * 12.9898));
      if (hz > lo * 0.7 && hz <= lo) mag += 0.3;
    }
    spec[i] = Math.max(0, Math.min(255, Math.round(mag * 235)));
  }
  return spec;
}
