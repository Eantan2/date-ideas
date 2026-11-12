'use strict';

// The little heart character. Each call gives back an SVG picture as text.
// Poses: 'wave' (hello), 'cheer' (celebrating), 'empty' (nothing here yet),
//        'loading' (waiting), 'oops' (something went wrong),
//        'sleepy' (late at night), 'love' (you both like it), 'party' (a milestone).
// Outfits: 'scarf' (winter), 'shades' (summer), 'crown' (anniversary), 'none'.
// Leave the outfit out and it picks one from the season and your anniversary.

// Is today the anniversary? The date is kept on this device only (see the footer).
function isAnniversary() {
  try {
    const a = localStorage.getItem('anniv'); // YYYY-MM-DD
    if (!a) return false;
    const n = new Date();
    return a.slice(5) === `${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  } catch (e) {
    return false;
  }
}

function autoOutfit() {
  if (isAnniversary()) return 'crown';
  const m = new Date().getMonth();
  if (m === 11 || m <= 1) return 'scarf';
  if (m >= 5 && m <= 7) return 'shades';
  return 'none';
}

function mascot(pose = 'wave', size = 120, outfitIn) {
  const INK = '#3A2A24'; // face
  const LIMB = 'currentColor'; // arms and legs follow the page colour, so they show in dark mode
  const BODY = '#E8775C';
  const BLUE = '#3B6BB5';
  const line = `fill="none" stroke="${LIMB}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="4.2" fill="${BODY}" stroke="${LIMB}" stroke-width="2.6"/>`;

  const eyeY = pose === 'loading' ? 45 : 50;
  let eyes = `<circle cx="54" cy="${eyeY}" r="3.4" fill="${INK}"/><circle cx="86" cy="${eyeY}" r="3.4" fill="${INK}"/>`;
  if (pose === 'sleepy') eyes = `<path d="M48 51 Q54 56 60 51 M80 51 Q86 56 92 51" ${thin}/>`;
  const brows = pose === 'oops' ? `<path d="M46 41 L59 45 M94 41 L81 45" ${thin}/>` : '';
  let mouth = `<path d="M60 62 Q70 73 80 62" ${line}/>`;
  if (pose === 'sleepy') mouth = `<ellipse cx="70" cy="68" rx="3.4" ry="3" ${thin}/>`;
  if (pose === 'love') mouth = `<path d="M58 61 Q70 78 82 61" ${line.replace(LIMB, INK)}/>`;
  if (pose === 'cheer' || pose === 'party') mouth = `<path d="M57 60 Q70 81 83 60 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M63 69 Q70 74 77 69" fill="none" stroke="#F7A998" stroke-width="3" stroke-linecap="round"/>`;
  if (pose === 'oops') mouth = `<ellipse cx="70" cy="68" rx="5" ry="4.2" ${thin}/>`;
  const cheeks = `<circle cx="45" cy="60" r="5.5" fill="#F7A998" opacity=".85"/><circle cx="95" cy="60" r="5.5" fill="#F7A998" opacity=".85"/>`;

  let arms = '';
  let extra = '';
  if (pose === 'wave') {
    arms = `<path d="M21 62 Q8 72 12 90" ${line}/><path d="M119 58 Q134 52 132 34" ${line}/>${hand(132, 31)}`;
    extra = `<path d="M124 17 Q129 12 135 16 M127 9 Q132 5 137 8" ${thin} stroke="${BLUE}"/>`;
  } else if (pose === 'cheer') {
    arms = `<path d="M21 58 Q6 46 8 24" ${line}/><path d="M119 58 Q134 46 132 24" ${line}/>${hand(8, 21)}${hand(132, 21)}`;
    extra =
      `<rect x="28" y="3" width="6" height="11" rx="1.5" fill="#F2CC8F" transform="rotate(25 31 8)"/>` +
      `<circle cx="104" cy="9" r="4" fill="${BLUE}"/>` +
      `<rect x="64" y="1" width="6" height="11" rx="1.5" fill="#8DB8A0" transform="rotate(-20 67 6)"/>` +
      `<circle cx="46" cy="9" r="3" fill="#C65D3B"/>` +
      `<rect x="116" y="2" width="5" height="9" rx="1.5" fill="#EDB9A4" transform="rotate(35 118 6)"/>`;
  } else if (pose === 'party') {
    arms = `<path d="M21 58 Q6 46 8 24" ${line}/><path d="M119 58 Q134 46 132 24" ${line}/>${hand(8, 21)}${hand(132, 21)}`;
    extra =
      `<path d="M60 20 L70 -6 L80 20 Z" fill="#EBB95A" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><circle cx="70" cy="-7" r="3.4" fill="${BLUE}"/>` +
      `<rect x="26" y="6" width="6" height="11" rx="1.5" fill="#EBB95A" transform="rotate(25 29 11)"/><circle cx="108" cy="8" r="4" fill="${BLUE}"/>` +
      `<rect x="112" y="30" width="5" height="9" rx="1.5" fill="#8DB8A0" transform="rotate(35 114 34)"/><circle cx="34" cy="30" r="3" fill="#C65D3B"/>`;
  } else if (pose === 'love') {
    arms = `<path d="M21 62 Q30 90 62 86" ${line}/><path d="M119 62 Q110 90 78 86" ${line}/>`;
    const h = (x, y, k, d) => `<path class="float" style="animation-delay:${d}s" transform="translate(${x} ${y}) scale(${k})" d="M0 8 C-9 1 -10 -3 -10 -6 C-10 -9 -8 -11 -5 -11 C-3 -11 -1 -10 0 -8 C1 -10 3 -11 5 -11 C8 -11 10 -9 10 -6 C10 -3 9 1 0 8Z" fill="#E8775C"/>`;
    extra = h(112, 14, 0.9, 0) + h(28, 8, 0.65, 0.5) + h(124, 40, 0.6, 1);
  } else if (pose === 'sleepy') {
    arms = `<path d="M21 62 Q8 72 10 88" ${line}/><path d="M119 62 Q132 72 130 88" ${line}/>`;
    extra =
      `<text class="float" x="104" y="26" font-size="18" font-weight="700" fill="${BLUE}" font-family="ui-rounded, system-ui, sans-serif">z</text>` +
      `<text class="float" style="animation-delay:.6s" x="118" y="12" font-size="13" font-weight="700" fill="${BLUE}" font-family="ui-rounded, system-ui, sans-serif">z</text>`;
  } else if (pose === 'empty') {
    arms = `<path d="M21 62 Q8 72 12 90" ${line}/><path d="M119 62 Q128 74 117 86" ${line}/>`;
    extra =
      `<text x="100" y="26" font-size="24" font-weight="700" fill="${BLUE}" font-family="ui-rounded, system-ui, sans-serif">?</text>` +
      `<rect x="100" y="80" width="32" height="42" rx="4" fill="${BLUE}"/>` +
      `<rect x="105" y="88" width="22" height="29" rx="2" fill="#fff"/>` +
      `<path d="M109 96h14M109 103h14M109 110h8" stroke="#C9D3E8" stroke-width="2.4" stroke-linecap="round"/>` +
      `<rect x="111" y="76" width="10" height="8" rx="2" fill="${INK}"/>`;
  } else if (pose === 'loading') {
    arms = `<path d="M21 62 Q8 72 10 88" ${line}/><path d="M119 62 Q132 72 130 88" ${line}/>`;
    extra =
      `<circle class="dot" cx="54" cy="8" r="3.6" fill="${BLUE}"/>` +
      `<circle class="dot" style="animation-delay:.2s" cx="70" cy="8" r="3.6" fill="${BLUE}"/>` +
      `<circle class="dot" style="animation-delay:.4s" cx="86" cy="8" r="3.6" fill="${BLUE}"/>`;
  } else if (pose === 'oops') {
    arms = `<path d="M21 60 Q4 46 24 22" ${line}/>${hand(25, 20)}<path d="M119 62 Q132 72 130 88" ${line}/>`;
    extra = `<path d="M108 14 Q116 26 108 31 Q100 26 108 14 Z" fill="#8FB8E8" stroke="${BLUE}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }

  const body =
    `<path d="M70 104 C30 78 20 56 20 40 C20 26 31 16 44 16 C55 16 64 22 70 31 C76 22 85 16 96 16 C109 16 120 26 120 40 C120 56 110 78 70 104 Z" fill="${BODY}"/>` +
    `<path d="M32 36 Q34 26 43 24" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3.5" stroke-linecap="round"/>`;
  const legs = `<path d="M60 98 L58 128 M50 130 L58 128 M80 98 L82 128 M90 130 L82 128" ${line}/>`;
  const shadow = `<ellipse cx="70" cy="134" rx="28" ry="4" fill="currentColor" opacity=".1"/>`;

  // Outfit goes on top of the face.
  const outfit = outfitIn || (['wave', 'empty', 'love', 'sleepy'].includes(pose) ? autoOutfit() : 'none');
  let wear = '';
  if (outfit === 'shades' && pose !== 'sleepy') wear = `<rect x="42" y="43" width="23" height="15" rx="6" fill="${INK}"/><rect x="75" y="43" width="23" height="15" rx="6" fill="${INK}"/><path d="M65 49 L75 49" stroke="${INK}" stroke-width="2.4"/><path d="M46 46 L52 46" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`;
  if (outfit === 'scarf') wear = `<path d="M50 90 Q70 100 90 90" fill="none" stroke="${BLUE}" stroke-width="10" stroke-linecap="round"/><rect x="82" y="92" width="8" height="18" rx="3" fill="${BLUE}"/><path d="M84 100 L90 100 M84 104 L90 104" stroke="#fff" stroke-opacity=".6" stroke-width="1.6"/>`;
  if (outfit === 'crown') wear = `<g transform="rotate(-8 70 20)"><path d="M54 24 L56 8 L63 16 L70 4 L77 16 L84 8 L86 24 Z" fill="#EBB95A" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><circle cx="70" cy="14" r="2.2" fill="#C65D3B"/></g>`;

  const h = Math.round((size * 150) / 140);
  return `<svg class="mascot mascot-${pose}" viewBox="0 0 140 150" width="${size}" height="${h}" aria-hidden="true" focusable="false">${shadow}<g class="m-body">${legs}${body}${cheeks}${eyes}${brows}${mouth}${wear}${arms}</g>${extra}</svg>`;
}

// A small plain heart for places that need an icon (like a card without a photo).
function miniHeart() {
  return `<svg class="mini-heart" viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path d="M12 21 C3 14 1 10 1 6.5 C1 3.5 3.3 1.5 6 1.5 C8.5 1.5 10.7 2.8 12 5 C13.3 2.8 15.5 1.5 18 1.5 C20.7 1.5 23 3.5 23 6.5 C23 10 21 14 12 21Z" fill="currentColor"/></svg>`;
}
