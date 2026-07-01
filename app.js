const ROUND_COLUMNS = [
  { key: 'Last32', label: 'Round of 32' },
  { key: 'Last16', label: 'Round of 16' },
  { key: 'QF', label: 'Quarter Finals' },
  { key: 'SF', label: 'Semi Finals' },
  { key: 'Final', label: 'Final' },
  { key: 'Winner', label: 'Champion' }
];

const FIFA_2026_BRACKET_ORDER = {
  'Round of 32': [73, 75, 74, 77, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  'Round of 16': [89, 90, 93, 94, 91, 92, 95, 96],
  'Quarter Finals': [97, 98, 99, 100],
  'Semi Finals': [101, 102],
  'Third Place': [103],
  'Final': [104]
};

const FIFA_2026_NEXT_MATCH = {
  73: 89,
  75: 89,
  74: 90,
  77: 90,
  76: 91,
  78: 91,
  79: 92,
  80: 92,
  83: 93,
  84: 93,
  81: 94,
  82: 94,
  86: 95,
  88: 95,
  85: 96,
  87: 96,
  89: 97,
  90: 97,
  93: 98,
  94: 98,
  91: 99,
  92: 99,
  95: 100,
  96: 100,
  97: 101,
  98: 101,
  99: 102,
  100: 102,
  101: 104,
  102: 104
};

const DEFAULT_CONFIG = {
  teams: window.TEAMS_CSV,
  awards: window.AWARDS_CSV,
  metadata: window.METADATA_CSV,
  previousPositions: window.PREVIOUS_POSITIONS_CSV,
  knockout: window.KNOCKOUT_CSV || '',
  goldenBoot: window.GOLDEN_BOOT_CSV || '',
  goldenGlove: window.GOLDEN_GLOVE_CSV || '',
  fallback: {
    teams: 'data/teams.csv',
    awards: 'data/awards.csv',
    metadata: 'data/metadata.csv',
    previousPositions: 'data/previous-positions.csv',
    knockout: 'data/knockout.csv',
    goldenBoot: '',
    goldenGlove: ''
  }
};

const config = { ...DEFAULT_CONFIG, ...(window.SHEET_CONFIG || {}) };
const forcedSource = new URLSearchParams(window.location.search).get('source');

const elements = {
  heroCards: document.getElementById('heroCards'),
  tournamentMeta: document.getElementById('tournamentMeta'),
  liveStatus: document.getElementById('liveStatus'),
  leaderboardCards: document.getElementById('leaderboardCards'),
  knockoutCentre: document.getElementById('knockoutCentre'),
  playerCards: document.getElementById('playerCards')
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map((header) => header.trim());
  return rows.map((cells) => headers.reduce((record, header, index) => {
    if (!header || Object.prototype.hasOwnProperty.call(record, header)) return record;
    record[header] = (cells[index] || '').trim();
    return record;
  }, {}));
}

function asNumber(value) {
  const number = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function isTruthySheetValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'qualified', 'winner', 'won'].includes(normalized) || asNumber(value) > 0;
}

function sheetCell(row, names) {
  const keys = Object.keys(row || {});
  const wanted = names.map((name) => ownerLookupKey(name));
  const key = keys.find((candidate) => wanted.includes(ownerLookupKey(candidate)));
  return key ? row[key] : '';
}

function hasSheetColumn(row, names) {
  const keys = Object.keys(row || {});
  const wanted = names.map((name) => ownerLookupKey(name));
  return keys.some((candidate) => wanted.includes(ownerLookupKey(candidate)));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatSigned(value) {
  const number = asNumber(value);
  return number > 0 ? `+${number}` : String(number);
}

async function fetchSheet(url) {
  if (!url) return [];
  const separator = url.includes('?') ? '&' : '?';
  const cacheBuster = url.startsWith('http') ? `${separator}ts=${Date.now()}` : '';
  const response = await fetch(`${url}${cacheBuster}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load sheet: ${response.status}`);
  return parseCSV(await response.text());
}

function snapshotRows(key) {
  return window.SNAPSHOT_DATA?.[key] || [];
}

async function fetchFallbackSheet(fallbackUrl, snapshotKey) {
  try {
    const rows = await fetchSheet(fallbackUrl);
    if (rows.length) return rows;
  } catch (error) {
    // Local file previews can block fetch(), so the embedded snapshot is the final fallback.
  }

  return snapshotRows(snapshotKey);
}

async function fetchSheetWithFallback(primaryUrl, fallbackUrl, snapshotKey) {
  if (forcedSource === 'embedded') {
    const rows = snapshotRows(snapshotKey);
    return {
      rows: rows.length ? rows : await fetchFallbackSheet(fallbackUrl, snapshotKey),
      source: 'snapshot'
    };
  }

  if (forcedSource === 'snapshot') {
    return {
      rows: await fetchFallbackSheet(fallbackUrl, snapshotKey),
      source: 'snapshot'
    };
  }

  const hasLiveSheet = /^https?:\/\//i.test(primaryUrl || '');

  try {
    const rows = await fetchSheet(primaryUrl);
    if (rows.length || !fallbackUrl) return { rows, source: 'live' };
  } catch (error) {
    if (hasLiveSheet) {
      throw error;
    }

    const rows = await fetchFallbackSheet(fallbackUrl, snapshotKey);
    if (rows.length || fallbackUrl || snapshotKey) {
      return { rows, source: 'snapshot' };
    }
    throw error;
  }

  if (hasLiveSheet) {
    return { rows: [], source: 'live' };
  }

  return {
    rows: await fetchFallbackSheet(fallbackUrl, snapshotKey),
    source: 'snapshot'
  };
}

function normaliseTeam(row, phase) {
  const knockoutFlags = ROUND_COLUMNS.reduce((flags, round) => {
    flags[round.key] = isTruthySheetValue(sheetCell(row, [round.key, round.label]));
    return flags;
  }, {});
  const qualifiedRound = [...ROUND_COLUMNS].reverse().find((round) => knockoutFlags[round.key]);
  const knockoutStarted = ROUND_COLUMNS.some((round) => hasSheetColumn(row, [round.key, round.label]))
    && !/group/i.test(phase || '');
  const hasExplicitStatus = hasSheetColumn(row, ['Qualified']) || hasSheetColumn(row, ['Eliminated']);
  const sheetQualified = isTruthySheetValue(sheetCell(row, ['Qualified']));
  const sheetEliminated = isTruthySheetValue(sheetCell(row, ['Eliminated']));
  const eliminated = hasExplicitStatus
    ? sheetEliminated
    : sheetEliminated || (knockoutStarted && !qualifiedRound && !sheetQualified);
  const qualified = !eliminated && (sheetQualified || Boolean(qualifiedRound));
  const gd = row.GD === undefined || row.GD === '' ? asNumber(row.GF) - asNumber(row.GA) : asNumber(row.GD);

  return {
    team: row.Team || '',
    owner: row.Owner || '',
    flag: row.Flag || '🏳️',
    mp: asNumber(row.MP),
    w: asNumber(row.W),
    d: asNumber(row.D),
    l: asNumber(row.L),
    gf: asNumber(row.GF),
    ga: asNumber(row.GA),
    gd,
    pts: asNumber(row.Pts),
    totalPoints: row['Total Points'] === undefined || row['Total Points'] === ''
      ? asNumber(row.Pts)
      : asNumber(row['Total Points']),
    knockoutFlags,
    currentRound: eliminated ? 'Eliminated' : qualifiedRound?.label || (qualified ? 'Qualified' : 'Active'),
    qualified,
    eliminated
  };
}

function buildPlayers(teams, previousPositions) {
  const previousRanks = previousPositions
    .filter((row) => row.Player)
    .map((row) => ({
      key: ownerLookupKey(row.Player),
      rank: asNumber(row.Rank)
    }));

  const playersByOwner = teams.reduce((map, team) => {
    if (!team.team || !team.owner) return map;
    if (!map.has(team.owner)) {
      map.set(team.owner, {
        owner: team.owner,
        mp: 0,
        pts: 0,
        gd: 0,
        gf: 0,
        ga: 0,
        w: 0,
        d: 0,
        l: 0,
        totalPoints: 0,
        teamsAlive: 0,
        teams: []
      });
    }

    const player = map.get(team.owner);
    player.mp += team.mp;
    player.pts += team.totalPoints;
    player.totalPoints += team.totalPoints;
    player.gd += team.gd;
    player.gf += team.gf;
    player.ga += team.ga;
    player.w += team.w;
    player.d += team.d;
    player.l += team.l;
    player.teamsAlive += team.eliminated ? 0 : 1;
    player.teams.push(team);
    return map;
  }, new Map());

  return [...playersByOwner.values()]
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.owner.localeCompare(b.owner))
    .map((player, index) => {
      const rank = index + 1;
      const ownerKey = ownerLookupKey(player.owner);
      const previous = previousRanks.find((entry) => entry.key === ownerKey)
        || previousRanks.find((entry) => entry.key.startsWith(ownerKey) || ownerKey.startsWith(entry.key));
      const previousRank = previous?.rank || rank;
      return {
        ...player,
        rank,
        previousRank,
        movement: previousRank - rank
      };
    });
}

function restoreMissingSquadTeams(players, liveTeams, phase) {
  const liveTeamKeys = new Set(liveTeams.map((team) => teamLookupKey(team.team)).filter(Boolean));
  const playersByOwner = new Map(players.map((player) => [ownerLookupKey(player.owner), player]));

  snapshotRows('teams')
    .map((row) => normaliseTeam(row, phase))
    .filter((team) => team.team && team.owner && !liveTeamKeys.has(teamLookupKey(team.team)))
    .forEach((team) => {
      const player = playersByOwner.get(ownerLookupKey(team.owner));
      if (!player) return;
      const alreadyShown = player.teams.some((ownedTeam) => teamLookupKey(ownedTeam.team) === teamLookupKey(team.team));
      if (alreadyShown) return;
      player.teams.push({
        ...team,
        qualified: false,
        eliminated: true,
        currentRound: 'Eliminated'
      });
    });
}

function ownerLookupKey(owner) {
  return String(owner || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function metadataMap(rows) {
  return rows.reduce((map, row) => {
    if (row.Setting) map[row.Setting] = row.Value || '';
    return map;
  }, {});
}

function teamMap(teams) {
  return teams.reduce((map, team) => {
    const key = teamLookupKey(team.team);
    if (key) map[key] = team;
    return map;
  }, {});
}

function ownerForTeam(teamName, teamsByName) {
  return teamsByName[teamLookupKey(teamName)]?.owner || '';
}

function teamLookupKey(teamName) {
  return String(teamName || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
}

function mappedFlagKey(teamName) {
  const key = teamLookupKey(teamName);
  if (key === 'england') return 'england';
  if (key === 'scotland') return 'scotland';
  return '';
}

function mappedFlagUrl(flagKey) {
  const urls = {
    england: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-e0067-e0062-e0065-e006e-e0067-e007f.svg',
    scotland: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-e0067-e0062-e0073-e0063-e0074-e007f.svg'
  };
  return urls[flagKey] || '';
}

function flagMarkup(team, className = 'team-flag') {
  const mappedFlag = mappedFlagKey(team?.team);
  if (mappedFlag) {
    const label = `${team.team} flag`;
    return `<img class="${className} flag-emoji flag-${mappedFlag}" src="${mappedFlagUrl(mappedFlag)}" alt="${escapeHTML(label)}" loading="lazy" decoding="async">`;
  }

  return `<span class="${className}">${escapeHTML(team?.flag || '')}</span>`;
}

function buildGoldenBootRace(rows, teamsByName) {
  return rows
    .filter((row) => row.Player && row.Team)
    .map((row) => {
      const team = teamsByName[teamLookupKey(row.Team)];
      return {
        player: row.Player,
        team: row.Team,
        owner: team?.owner || row.Owner || 'Owner TBC',
        goals: asNumber(row.Goals),
        assists: asNumber(row.Assists),
        teamPoints: team?.pts || 0
      };
    })
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.teamPoints - a.teamPoints || a.player.localeCompare(b.player));
}

function buildGoldenGloveRace(rows, teamsByName) {
  return rows
    .filter((row) => row.Player && row.Team)
    .map((row) => {
      const team = teamsByName[teamLookupKey(row.Team)];
      return {
        player: row.Player,
        team: row.Team,
        owner: team?.owner || row.Owner || 'Owner TBC',
        cleanSheets: asNumber(row['Clean Sheets']),
        goalsConceded: asNumber(row['Goals Conceded']),
        teamPoints: team?.pts || 0
      };
    })
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.goalsConceded - b.goalsConceded || b.teamPoints - a.teamPoints || a.player.localeCompare(b.player));
}

function prizeAmount(awards, awardName) {
  const award = awards.find((row) => String(row.Award || '').trim().toLowerCase() === awardName.toLowerCase());
  if (!award) return '';

  const amountKey = Object.keys(award).find((key) => /^amount/i.test(key)) || 'Amount';
  const amount = award[amountKey] || award.Amount || '';
  return amount ? `Prize £${asNumber(amount)}` : '';
}

function placeLabel(place) {
  if (place === 1) return '🥇 1st Place';
  if (place === 2) return '🥈 2nd Place';
  return '🥉 3rd Place';
}

function prizeLabel(place) {
  if (place === 1) return '1st Place';
  if (place === 2) return '2nd Place';
  return '3rd Place';
}

function placementCard(player, place, awards) {
  const label = placeLabel(place);
  const prize = prizeAmount(awards, prizeLabel(place));
  return {
    label,
    value: player ? player.owner : 'TBC',
    detail: player ? `${player.pts} pts${prize ? ` · ${prize}` : ''}` : prize || 'Awaiting leaderboard'
  };
}

function raceLeaderCard(label, raceLeader, awards, prizeName, type) {
  const prize = prizeAmount(awards, prizeName);
  const icon = type === 'boot' ? '🥅' : '🧤';
  if (!raceLeader) {
    return {
      icon,
      label,
      value: 'TBC',
      detail: prize || 'Awaiting live entries'
    };
  }

  const primaryStat = type === 'boot'
    ? `${raceLeader.goals} goals`
    : `${raceLeader.cleanSheets} clean sheets`;
  const secondaryStat = type === 'boot'
    ? `${raceLeader.assists} assists`
    : `${raceLeader.goalsConceded} conceded`;

  return {
    icon,
    label,
    value: raceLeader.owner,
    detail: `${raceLeader.player} · ${raceLeader.team} · ${primaryStat} · ${secondaryStat}${prize ? ` · ${prize}` : ''}`
  };
}

function movementMarkup(movement) {
  if (movement > 0) return `<span class="movement movement-up" aria-label="Up ${movement} places">▲${movement}</span>`;
  if (movement < 0) return `<span class="movement movement-down" aria-label="Down ${Math.abs(movement)} places">▼${Math.abs(movement)}</span>`;
  return '<span class="movement movement-flat" aria-label="No position change">=</span>';
}

function teamPill(team) {
  const statusClass = team.eliminated ? 'is-eliminated' : team.qualified ? 'is-qualified' : 'is-active';
  const statusIcon = team.eliminated ? '<span aria-hidden="true">×</span>' : '';
  return `
    <span class="team-pill ${statusClass}">
      ${flagMarkup(team)}
      <span>
        <strong>${escapeHTML(team.team)}</strong>
        <small>${escapeHTML(team.currentRound)} · ${team.pts} pts · ${formatSigned(team.gd)} GD</small>
      </span>
      ${statusIcon}
    </span>
  `;
}

function renderHero(players, awards, goldenBootRace, goldenGloveRace, meta, source) {
  const lastUpdated = meta['Last Updated'] || 'Awaiting update';
  const phase = meta['Tournament Phase'] || 'Tournament';

  elements.tournamentMeta.textContent = `${phase} · Updated ${lastUpdated}`;
  elements.liveStatus.textContent = source === 'live'
    ? 'Live from Google Sheets'
    : 'Workbook snapshot';
  elements.heroCards.innerHTML = [
    placementCard(players[0], 1, awards),
    placementCard(players[1], 2, awards),
    placementCard(players[2], 3, awards),
    raceLeaderCard('Golden Boot', goldenBootRace[0], awards, 'Golden Boot', 'boot'),
    raceLeaderCard('Golden Glove', goldenGloveRace[0], awards, 'Golden Glove', 'glove')
  ].map((card, index) => `
    <article class="hero-card ${index < 3 ? 'hero-card-placement' : 'hero-card-race'}">
      <p>${card.icon ? `<span class="hero-card-icon" aria-hidden="true">${escapeHTML(card.icon)}</span>` : ''}${escapeHTML(card.label)}</p>
      <strong>${escapeHTML(card.value)}</strong>
      <span>${escapeHTML(card.detail)}</span>
    </article>
  `).join('');
}

function playerCard(player) {
  const teams = [...player.teams].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.pts - a.pts || a.team.localeCompare(b.team));
  return `
    <details class="player-card team-owner-card">
      <summary>
        <span class="rank-badge">${player.rank}</span>
        <span class="player-main">
          <strong>${escapeHTML(player.owner)}</strong>
          <small>${player.w}W ${player.d}D ${player.l}L</small>
        </span>
        <span class="player-points">${player.pts}<small>pts</small></span>
        ${movementMarkup(player.movement)}
        <span class="expand-indicator" aria-hidden="true"></span>
      </summary>
      <div class="player-expanded">
        <div class="stat-strip">
          <span><strong>${player.mp}</strong><small>MP</small></span>
          <span><strong>${formatSigned(player.gd)}</strong><small>GD</small></span>
          <span><strong>${player.gf}</strong><small>GF</small></span>
          <span><strong>${player.ga}</strong><small>GA</small></span>
        </div>
        <div class="team-pill-grid">${teams.map(teamPill).join('')}</div>
      </div>
    </details>
  `;
}

function renderLeaderboard(players) {
  elements.leaderboardCards.innerHTML = `
    <div class="leaderboard-table-card">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Player</th>
            <th scope="col">MP</th>
            <th scope="col">Total</th>
            <th scope="col">GD</th>
            <th scope="col">W</th>
            <th scope="col">D</th>
            <th scope="col">L</th>
          </tr>
        </thead>
        <tbody>
          ${players.map((player) => `
            <tr class="rank-${player.rank} ${player.rank === 1 ? 'is-leader' : ''}">
              <td><span class="table-position"><span class="table-rank">${player.rank}</span>${movementMarkup(player.movement)}</span></td>
              <td><strong>${escapeHTML(player.owner)}</strong></td>
              <td>${player.mp}</td>
              <td class="total-points"><strong>${player.totalPoints}</strong></td>
              <td>${formatSigned(player.gd)}</td>
              <td>${player.w}</td>
              <td>${player.d}</td>
              <td>${player.l}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function roundFromFixture(row) {
  return row.Round || row.round || row.Stage || row.stage || '';
}

function roundLabel(round) {
  const normalized = String(round || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  const labels = {
    last32: 'Round of 32',
    roundof32: 'Round of 32',
    r32: 'Round of 32',
    last16: 'Round of 16',
    roundof16: 'Round of 16',
    r16: 'Round of 16',
    qf: 'Quarter Finals',
    quarterfinal: 'Quarter Finals',
    quarterfinals: 'Quarter Finals',
    sf: 'Semi Finals',
    semifinal: 'Semi Finals',
    semifinals: 'Semi Finals',
    thirdplace: 'Third Place',
    thirdplaceplayoff: 'Third Place',
    final: 'Final',
    champion: 'Champion',
    winner: 'Champion'
  };
  return labels[normalized] || String(round || '').trim();
}

function fixtureTeam(row, side) {
  const names = side === 1
    ? ['Team 1', 'Team1', 'Home Team', 'Home', 'Team A', 'TeamA']
    : ['Team 2', 'Team2', 'Away Team', 'Away', 'Team B', 'TeamB'];
  const key = names.find((name) => row[name]);
  return key ? row[key] : '';
}

function fixtureSlot(teamName, teamsByName) {
  const normalizedName = String(teamName || '').trim();
  const key = teamLookupKey(normalizedName);

  if (!normalizedName || ['tbd', 'tbc'].includes(key)) {
    return {
      team: normalizedName || 'TBD',
      owner: 'Owner TBD',
      flag: '',
      pending: true
    };
  }

  return teamsByName[key] || {
    team: normalizedName,
    owner: 'Owner TBD',
    flag: '',
    pending: true
  };
}

function officialNextMatch(match, sheetNextMatch) {
  const matchNumberValue = asNumber(match);
  return FIFA_2026_NEXT_MATCH[matchNumberValue] || sheetNextMatch || '';
}

function buildFixturesFromKnockoutRows(rows, teamsByName) {
  const byRound = new Map();
  rows.forEach((row) => {
    const round = roundLabel(roundFromFixture(row));
    if (!round) return;
    const first = fixtureSlot(fixtureTeam(row, 1), teamsByName);
    const second = fixtureSlot(fixtureTeam(row, 2), teamsByName);
    const match = row.Match || row.match || '';
    const sheetNextMatch = row['Next Match'] || row['Next match'] || row.NextMatch || row.nextMatch || '';
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push({
      first,
      second,
      winner: row.Winner || row.winner || '',
      match,
      nextMatch: officialNextMatch(match, sheetNextMatch),
      date: row['UK Date'] || row.Date || row.date || ''
    });
  });
  return byRound;
}

function orderedRounds(fixtures) {
  const roundOrder = ['Round of 32', 'Round of 16', 'Quarter Finals', 'Semi Finals', 'Third Place', 'Final', 'Champion'];
  return [...fixtures.entries()].sort(([firstRound], [secondRound]) => {
    const firstIndex = roundOrder.indexOf(firstRound);
    const secondIndex = roundOrder.indexOf(secondRound);
    if (firstIndex === -1 && secondIndex === -1) return firstRound.localeCompare(secondRound);
    if (firstIndex === -1) return 1;
    if (secondIndex === -1) return -1;
    return firstIndex - secondIndex;
  });
}

function buildFixturesFromTeamColumns(teams) {
  const byRound = new Map();
  ROUND_COLUMNS.forEach((round) => {
    const roundTeams = teams.filter((team) => team.knockoutFlags[round.key]);
    if (!roundTeams.length) return;
    const fixtures = [];
    for (let index = 0; index < roundTeams.length; index += 2) {
      fixtures.push({
        first: roundTeams[index],
        second: roundTeams[index + 1],
        winner: round.key === 'Winner' ? roundTeams[index]?.team : '',
        nextMatch: ''
      });
    }
    byRound.set(round.label, fixtures);
  });
  return byRound;
}

function isFixtureWinner(team, winner) {
  return Boolean(winner && team?.team?.toLowerCase() === winner.toLowerCase());
}

function fixtureSide(team, winner, sideClass = '') {
  if (!team) return '<div class="fixture-team is-empty"><span>TBD</span><small>Owner TBD</small></div>';
  const isWinner = isFixtureWinner(team, winner);
  return `
    <div class="fixture-team ${sideClass} ${isWinner ? 'is-winner' : ''} ${team.pending ? 'is-empty' : ''}">
      <span class="fixture-team-name">${flagMarkup(team, 'fixture-flag')}<span class="fixture-country">${escapeHTML(team.team)}</span></span>
      <small>${escapeHTML(team.owner)}</small>
    </div>
  `;
}

function fixtureMarkup(fixture, sideClass = '', rowSpan = 1, index = 0) {
  const matchLabel = fixture.match ? `M${fixture.match}` : '';
  const nextLabel = fixture.nextMatch ? `Winner to M${fixture.nextMatch}` : '';
  const dateLabel = fixture.date || '';
  const rowStart = (index * rowSpan) + 1;
  const gridStyle = `--row-start: ${rowStart}; --row-span: ${rowSpan};`;
  const winnerName = [fixture.first, fixture.second].find((team) => isFixtureWinner(team, fixture.winner))?.team || '';

  return `
    <div class="fixture ${sideClass} ${fixture.nextMatch ? 'has-next-match' : ''}" style="${gridStyle}">
      <div class="fixture-meta">
        <span>${escapeHTML(matchLabel)}</span>
        <span>${escapeHTML(dateLabel)}</span>
      </div>
      ${winnerName ? `<div class="fixture-status">Winner: ${escapeHTML(winnerName)}</div>` : ''}
      ${fixtureSide(fixture.first, fixture.winner, 'fixture-home')}
      <span class="versus">vs</span>
      ${fixtureSide(fixture.second, fixture.winner, 'fixture-away')}
      ${nextLabel ? `<span class="fixture-progress">${escapeHTML(nextLabel)}</span>` : ''}
    </div>
  `;
}

function roundFixtures(fixtures, label) {
  return fixtures.get(label) || [];
}

function matchNumber(match) {
  const number = asNumber(match);
  return number || Number.MAX_SAFE_INTEGER;
}

function sortByMatch(fixtures) {
  return [...fixtures].sort((a, b) => matchNumber(a.match) - matchNumber(b.match));
}

function sortByOfficialBracketOrder(fixtures, round) {
  const order = FIFA_2026_BRACKET_ORDER[round] || [];
  if (!order.length) return sortByMatch(fixtures);

  return [...fixtures].sort((a, b) => {
    const firstIndex = order.indexOf(matchNumber(a.match));
    const secondIndex = order.indexOf(matchNumber(b.match));
    if (firstIndex === -1 && secondIndex === -1) return matchNumber(a.match) - matchNumber(b.match);
    if (firstIndex === -1) return 1;
    if (secondIndex === -1) return -1;
    return firstIndex - secondIndex;
  });
}

function bracketRounds(fixtures) {
  const finalFixtures = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Final'), 'Final');
  const thirdPlaceFixtures = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Third Place'), 'Third Place');
  const sf = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Semi Finals'), 'Semi Finals');
  const qf = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Quarter Finals'), 'Quarter Finals');
  const r16 = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Round of 16'), 'Round of 16');
  const r32 = sortByOfficialBracketOrder(roundFixtures(fixtures, 'Round of 32'), 'Round of 32');

  return { r32, r16, qf, sf, finalFixtures, thirdPlaceFixtures };
}

function bracketColumn(title, fixtures, sideClass = '', rowSpan = 1, subtitle = '') {
  return `
    <article class="bracket-column ${sideClass}" style="--round-span: ${rowSpan}">
      <div class="round-title">
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(subtitle || `${fixtures.length} ${fixtures.length === 1 ? 'tie' : 'ties'}`)}</span>
      </div>
      <div class="fixtures">${fixtures.map((fixture, index) => fixtureMarkup(fixture, sideClass, rowSpan, index)).join('')}</div>
    </article>
  `;
}

function splitRound(fixtures, midpoint) {
  return {
    left: fixtures.slice(0, midpoint),
    right: fixtures.slice(midpoint)
  };
}

function renderBracket(fixtures) {
  const ordered = bracketRounds(fixtures);
  const r32 = splitRound(ordered.r32, 8);
  const r16 = splitRound(ordered.r16, 4);
  const qf = splitRound(ordered.qf, 2);
  const sf = splitRound(ordered.sf, 1);

  return `
    <div class="bracket-shell">
      ${bracketColumn('Round of 32', r32.left, 'bracket-left', 1, 'Matches 73-84')}
      ${bracketColumn('Round of 16', r16.left, 'bracket-left', 2, 'Matches 89-94')}
      ${bracketColumn('Quarter Finals', qf.left, 'bracket-left', 4, 'Matches 97-98')}
      ${bracketColumn('Semi Finals', sf.left, 'bracket-left', 8, 'Match 101')}
      <div class="bracket-center" aria-label="Final fixtures">
        ${bracketColumn('Final', ordered.finalFixtures, 'bracket-final bracket-compact', 1, 'Match 104')}
        ${bracketColumn('3rd Place', ordered.thirdPlaceFixtures, 'bracket-third bracket-compact', 1, 'Match 103')}
      </div>
      ${bracketColumn('Semi Finals', sf.right, 'bracket-right', 8, 'Match 102')}
      ${bracketColumn('Quarter Finals', qf.right, 'bracket-right', 4, 'Matches 99-100')}
      ${bracketColumn('Round of 16', r16.right, 'bracket-right', 2, 'Matches 91-96')}
      ${bracketColumn('Round of 32', r32.right, 'bracket-right', 1, 'Matches 76-88')}
    </div>
  `;
}

function renderKnockout(teams, knockoutRows) {
  const teamsByName = teamMap(teams);
  const fixtures = knockoutRows.length
    ? buildFixturesFromKnockoutRows(knockoutRows, teamsByName)
    : buildFixturesFromTeamColumns(teams);

  if (!fixtures.size) {
    elements.knockoutCentre.classList.add('is-empty');
    elements.knockoutCentre.innerHTML = `
      <div class="empty-state">
        <strong>Bracket awaiting qualification</strong>
        <span>The knockout centre will populate automatically from the published sheet once round columns or a Knockout tab contain teams.</span>
      </div>
    `;
    return;
  }

  elements.knockoutCentre.classList.remove('is-empty');
  elements.knockoutCentre.innerHTML = renderBracket(fixtures);
}

function renderPlayers(players) {
  elements.playerCards.innerHTML = players.map((player) => playerCard(player)).join('');
}

function showLoading() {
  const loading = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  elements.heroCards.innerHTML = loading;
  elements.leaderboardCards.innerHTML = loading;
  elements.playerCards.innerHTML = loading;
  elements.knockoutCentre.innerHTML = '<div class="skeleton-card wide"></div>';
}

function showError(error) {
  const message = `
    <div class="empty-state error">
      <strong>Unable to load live data</strong>
      <span>${escapeHTML(error.message || 'Please check the published Google Sheets CSV links.')}</span>
    </div>
  `;
  elements.heroCards.innerHTML = message;
  elements.leaderboardCards.innerHTML = message;
  elements.playerCards.innerHTML = message;
  elements.knockoutCentre.innerHTML = message;
  elements.liveStatus.textContent = 'Data connection issue';
}

async function loadApp() {
  showLoading();
  try {
    const fallback = config.fallback || {};
    const [teamSheet, awardSheet, metadataSheet, previousSheet, knockoutSheet, goldenBootSheet, goldenGloveSheet] = await Promise.all([
      fetchSheetWithFallback(config.teams, fallback.teams, 'teams'),
      fetchSheetWithFallback(config.awards, fallback.awards, 'awards'),
      fetchSheetWithFallback(config.metadata, fallback.metadata, 'metadata'),
      fetchSheetWithFallback(config.previousPositions, fallback.previousPositions, 'previousPositions'),
      fetchSheetWithFallback(config.knockout, fallback.knockout, 'knockout'),
      fetchSheetWithFallback(config.goldenBoot, fallback.goldenBoot, 'goldenBoot'),
      fetchSheetWithFallback(config.goldenGlove, fallback.goldenGlove, 'goldenGlove')
    ]);
    const meta = metadataMap(metadataSheet.rows);
    const teams = teamSheet.rows
      .filter((row) => row.Team && row.Owner)
      .map((row) => normaliseTeam(row, meta['Tournament Phase']));
    const players = buildPlayers(teams, previousSheet.rows);
    restoreMissingSquadTeams(players, teams, meta['Tournament Phase']);
    const teamsByName = teamMap(teams);
    const goldenBootRace = buildGoldenBootRace(goldenBootSheet.rows, teamsByName);
    const goldenGloveRace = buildGoldenGloveRace(goldenGloveSheet.rows, teamsByName);
    const source = [teamSheet, awardSheet, metadataSheet, previousSheet, knockoutSheet, goldenBootSheet, goldenGloveSheet].some((sheet) => sheet.source === 'snapshot')
      ? 'snapshot'
      : 'live';

    renderHero(players, awardSheet.rows, goldenBootRace, goldenGloveRace, meta, source);
    renderLeaderboard(players);
    renderKnockout(teams, knockoutSheet.rows);
    renderPlayers(players);
  } catch (error) {
    showError(error);
  }
}

loadApp();
