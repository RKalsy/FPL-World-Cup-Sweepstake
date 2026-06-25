const ROUND_COLUMNS = [
  { key: 'Last32', label: 'Round of 32' },
  { key: 'Last16', label: 'Round of 16' },
  { key: 'QF', label: 'Quarter Finals' },
  { key: 'SF', label: 'Semi Finals' },
  { key: 'Final', label: 'Final' },
  { key: 'Winner', label: 'Champion' }
];

const DEFAULT_CONFIG = {
  teams: window.TEAMS_CSV,
  awards: window.AWARDS_CSV,
  metadata: window.METADATA_CSV,
  previousPositions: window.PREVIOUS_POSITIONS_CSV,
  knockout: window.KNOCKOUT_CSV || '',
  fallback: {
    teams: 'data/teams.csv',
    awards: 'data/awards.csv',
    metadata: 'data/metadata.csv',
    previousPositions: 'data/previous-positions.csv',
    knockout: ''
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
  playerCards: document.getElementById('playerCards'),
  awardCards: document.getElementById('awardCards')
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
    return {
      rows: snapshotRows(snapshotKey),
      source: 'snapshot'
    };
  }

  if (forcedSource === 'snapshot') {
    return {
      rows: await fetchFallbackSheet(fallbackUrl, snapshotKey),
      source: 'snapshot'
    };
  }

  try {
    const rows = await fetchSheet(primaryUrl);
    if (rows.length || !fallbackUrl) return { rows, source: 'live' };
  } catch (error) {
    const rows = await fetchFallbackSheet(fallbackUrl, snapshotKey);
    if (rows.length || fallbackUrl || snapshotKey) {
      return { rows, source: 'snapshot' };
    }
    throw error;
  }

  return {
    rows: await fetchFallbackSheet(fallbackUrl, snapshotKey),
    source: 'snapshot'
  };
}

function normaliseTeam(row, phase) {
  const knockoutFlags = ROUND_COLUMNS.reduce((flags, round) => {
    flags[round.key] = isTruthySheetValue(row[round.key]);
    return flags;
  }, {});
  const qualifiedRound = [...ROUND_COLUMNS].reverse().find((round) => knockoutFlags[round.key]);
  const knockoutStarted = ROUND_COLUMNS.some((round) => Object.prototype.hasOwnProperty.call(row, round.key))
    && !/group/i.test(phase || '');
  const eliminated = knockoutStarted && !qualifiedRound;
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
    knockoutFlags,
    currentRound: qualifiedRound?.label || (eliminated ? 'Eliminated' : 'Active'),
    qualified: Boolean(qualifiedRound),
    eliminated
  };
}

function buildPlayers(teams, previousPositions) {
  const previousRanks = previousPositions.reduce((map, row) => {
    if (row.Player) map[row.Player] = asNumber(row.Rank);
    return map;
  }, {});

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
        teamsAlive: 0,
        teams: []
      });
    }

    const player = map.get(team.owner);
    player.mp += team.mp;
    player.pts += team.pts;
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
      const previousRank = previousRanks[player.owner] || rank;
      return {
        ...player,
        rank,
        previousRank,
        movement: previousRank - rank
      };
    });
}

function metadataMap(rows) {
  return rows.reduce((map, row) => {
    if (row.Setting) map[row.Setting] = row.Value || '';
    return map;
  }, {});
}

function teamMap(teams) {
  return teams.reduce((map, team) => {
    map[team.team.toLowerCase()] = team;
    return map;
  }, {});
}

function movementMarkup(movement) {
  if (movement > 0) return `<span class="movement movement-up">▲ ${movement}</span>`;
  if (movement < 0) return `<span class="movement movement-down">▼ ${Math.abs(movement)}</span>`;
  return '<span class="movement movement-flat">−</span>';
}

function teamPill(team) {
  const statusClass = team.eliminated ? 'is-eliminated' : team.qualified ? 'is-qualified' : 'is-active';
  const statusIcon = team.eliminated ? '<span aria-hidden="true">×</span>' : '';
  return `
    <span class="team-pill ${statusClass}">
      <span class="team-flag">${escapeHTML(team.flag)}</span>
      <span>
        <strong>${escapeHTML(team.team)}</strong>
        <small>${escapeHTML(team.currentRound)} · ${team.pts} pts · ${formatSigned(team.gd)} GD</small>
      </span>
      ${statusIcon}
    </span>
  `;
}

function renderHero(players, teams, awards, meta, source) {
  const leader = players[0];
  const teamsAlive = teams.filter((team) => !team.eliminated).length;
  const goldenBoot = awards.find((award) => /golden boot/i.test(award.Award || ''));
  const goldenBootTeam = goldenBoot?.Team || 'TBC';
  const lastUpdated = meta['Last Updated'] || 'Awaiting update';
  const phase = meta['Tournament Phase'] || 'Tournament';

  elements.tournamentMeta.textContent = `${phase} · Updated ${lastUpdated}`;
  elements.liveStatus.textContent = source === 'live'
    ? 'Live from Google Sheets'
    : 'Workbook snapshot';
  elements.heroCards.innerHTML = [
    {
      label: 'Leader',
      value: leader ? leader.owner : 'TBC',
      detail: leader ? `${leader.pts} pts · ${leader.teamsAlive} teams alive` : 'Waiting for scores'
    },
    {
      label: 'Teams Alive',
      value: teamsAlive,
      detail: `${teams.length} teams tracked`
    },
    {
      label: 'Golden Boot',
      value: goldenBootTeam,
      detail: goldenBoot?.Team ? 'Award tracker' : 'Awaiting sheet update'
    }
  ].map((card) => `
    <article class="hero-card">
      <p>${escapeHTML(card.label)}</p>
      <strong>${escapeHTML(card.value)}</strong>
      <span>${escapeHTML(card.detail)}</span>
    </article>
  `).join('');
}

function playerCard(player) {
  const teams = [...player.teams].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.pts - a.pts || a.team.localeCompare(b.team));
  return `
    <details class="player-card team-owner-card ${player.rank === 1 ? 'is-leader' : ''}">
      <summary>
        <span class="rank-badge">${player.rank}</span>
        <span class="player-main">
          <strong>${escapeHTML(player.owner)}</strong>
          <small>${player.teamsAlive} teams alive · ${player.w}W ${player.d}D ${player.l}L</small>
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
            <th scope="col">Pts</th>
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
              <td><strong>${escapeHTML(player.owner)}</strong><small>${player.teamsAlive} teams alive</small></td>
              <td>${player.mp}</td>
              <td><strong>${player.pts}</strong></td>
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

function fixtureTeam(row, side) {
  const names = side === 1
    ? ['Team 1', 'Team1', 'Home', 'Team A', 'TeamA']
    : ['Team 2', 'Team2', 'Away', 'Team B', 'TeamB'];
  const key = names.find((name) => row[name]);
  return key ? row[key] : '';
}

function buildFixturesFromKnockoutRows(rows, teamsByName) {
  const byRound = new Map();
  rows.forEach((row) => {
    const round = roundFromFixture(row);
    if (!round) return;
    const first = teamsByName[fixtureTeam(row, 1).toLowerCase()];
    const second = teamsByName[fixtureTeam(row, 2).toLowerCase()];
    if (!first && !second) return;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push({
      first,
      second,
      winner: row.Winner || row.winner || ''
    });
  });
  return byRound;
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
        winner: round.key === 'Winner' ? roundTeams[index]?.team : ''
      });
    }
    byRound.set(round.label, fixtures);
  });
  return byRound;
}

function fixtureSide(team, winner) {
  if (!team) return '<div class="fixture-team is-empty"><span>TBC</span><small>Owner TBC</small></div>';
  const isWinner = winner && team.team.toLowerCase() === winner.toLowerCase();
  return `
    <div class="fixture-team ${isWinner ? 'is-winner' : ''}">
      <span>${escapeHTML(team.flag)} ${escapeHTML(team.team)}</span>
      <small>${escapeHTML(team.owner)}</small>
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
  elements.knockoutCentre.innerHTML = [...fixtures.entries()].map(([round, roundFixtures]) => `
    <article class="round-card">
      <div class="round-title">
        <strong>${escapeHTML(round)}</strong>
        <span>${roundFixtures.length} ${roundFixtures.length === 1 ? 'tie' : 'ties'}</span>
      </div>
      <div class="fixtures">
        ${roundFixtures.map((fixture) => `
          <div class="fixture">
            ${fixtureSide(fixture.first, fixture.winner)}
            <span class="versus">vs</span>
            ${fixtureSide(fixture.second, fixture.winner)}
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function renderPlayers(players) {
  elements.playerCards.innerHTML = players.map((player) => playerCard(player)).join('');
}

function renderAwards(awards, teams) {
  const teamsByName = teamMap(teams);
  const fallbackAwards = awards.length ? awards : [
    { Award: 'World Cup Winner', Team: '' },
    { Award: 'Golden Boot', Team: '' },
    { Award: 'Golden Glove', Team: '' }
  ];

  elements.awardCards.innerHTML = fallbackAwards.map((award) => {
    const team = award.Team ? teamsByName[award.Team.toLowerCase()] : null;
    return `
      <article class="award-card">
        <p>${escapeHTML(award.Award || 'Award')}</p>
        <strong>${escapeHTML(team ? `${team.flag} ${team.team}` : award.Team || 'TBC')}</strong>
        <span>${escapeHTML(team ? team.owner : 'Awaiting sheet update')}</span>
      </article>
    `;
  }).join('');
}

function showLoading() {
  const loading = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  elements.heroCards.innerHTML = loading;
  elements.leaderboardCards.innerHTML = loading;
  elements.playerCards.innerHTML = loading;
  elements.awardCards.innerHTML = loading;
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
  elements.awardCards.innerHTML = message;
  elements.knockoutCentre.innerHTML = message;
  elements.liveStatus.textContent = 'Data connection issue';
}

async function loadApp() {
  showLoading();
  try {
    const fallback = config.fallback || {};
    const [teamSheet, awardSheet, metadataSheet, previousSheet, knockoutSheet] = await Promise.all([
      fetchSheetWithFallback(config.teams, fallback.teams, 'teams'),
      fetchSheetWithFallback(config.awards, fallback.awards, 'awards'),
      fetchSheetWithFallback(config.metadata, fallback.metadata, 'metadata'),
      fetchSheetWithFallback(config.previousPositions, fallback.previousPositions, 'previousPositions'),
      fetchSheetWithFallback(config.knockout, fallback.knockout, 'knockout')
    ]);
    const meta = metadataMap(metadataSheet.rows);
    const teams = teamSheet.rows
      .filter((row) => row.Team && row.Owner)
      .map((row) => normaliseTeam(row, meta['Tournament Phase']));
    const players = buildPlayers(teams, previousSheet.rows);
    const source = [teamSheet, awardSheet, metadataSheet, previousSheet].some((sheet) => sheet.source === 'snapshot')
      ? 'snapshot'
      : 'live';

    renderHero(players, teams, awardSheet.rows, meta, source);
    renderLeaderboard(players);
    renderKnockout(teams, knockoutSheet.rows);
    renderPlayers(players);
    renderAwards(awardSheet.rows, teams);
  } catch (error) {
    showError(error);
  }
}

loadApp();
