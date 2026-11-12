'use strict';

// The little heart character. Each call gives back an SVG picture as text.
// Poses: 'wave' (hello), 'cheer' (celebrating), 'empty' (nothing here yet),
//        'loading' (waiting), 'oops' (something went wrong).
function mascot(pose = 'wave', size = 120) {
  const INK = '#3A2A24';
  const BODY = '#E8775C';
  const BLUE = '#3B6BB5';
  const line = `fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="4.2" fill="${BODY}" stroke="${INK}" stroke-width="2.6"/>`;

  const eyeY = pose === 'loading' ? 45 : 50;
  const eyes = `<circle cx="54" cy="${eyeY}" r="3.4" fill="${INK}"/><circle cx="86" cy="${eyeY}" r="3.4" fill="${INK}"/>`;
  const brows = pose === 'oops' ? `<path d="M46 41 L59 45 M94 41 L81 45" ${thin}/>` : '';
  let mouth = `<path d="M60 62 Q70 73 80 62" ${line}/>`;
  if (pose === 'cheer') mouth = `<path d="M57 60 Q70 81 83 60 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M63 69 Q70 74 77 69" fill="none" stroke="#F7A998" stroke-width="3" stroke-linecap="round"/>`;
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
  const shadow = `<ellipse cx="70" cy="134" rx="28" ry="4" fill="${INK}" opacity=".08"/>`;

  const h = Math.round((size * 150) / 140);
  return `<svg class="mascot mascot-${pose}" viewBox="0 0 140 150" width="${size}" height="${h}" aria-hidden="true" focusable="false">${shadow}<g class="m-body">${legs}${body}${cheeks}${eyes}${brows}${mouth}${arms}</g>${extra}</svg>`;
}

// A small plain heart for places that need an icon (like a card without a photo).
function miniHeart() {
  return `<svg class="mini-heart" viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path d="M12 21 C3 14 1 10 1 6.5 C1 3.5 3.3 1.5 6 1.5 C8.5 1.5 10.7 2.8 12 5 C13.3 2.8 15.5 1.5 18 1.5 C20.7 1.5 23 3.5 23 6.5 C23 10 21 14 12 21Z" fill="currentColor"/></svg>`;
}
