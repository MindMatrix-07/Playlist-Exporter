const fetch = require('isomorphic-unfetch');

// Dynamic require for spotify-url-info to avoid initialization errors
let spotifyUrlInfo;
try {
  spotifyUrlInfo = require('spotify-url-info')(fetch);
} catch (e) {
  console.error('Failed to load spotify-url-info:', e);
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing Spotify URL parameter.' });
  }

  try {
    if (!spotifyUrlInfo) {
      throw new Error('spotify-url-info is not installed or failed to load.');
    }

    // Step 1: Scrape playlist info and tracks
    console.log('Scraping playlist via spotify-url-info...');
    const playlistData = await spotifyUrlInfo.getData(url);
    const rawTracks = await spotifyUrlInfo.getTracks(url);
    const playlistImage = playlistData.coverArt?.sources?.[0]?.url || '';

    // Step 2: Fetch individual track cover art via /api/spotify/lookup if env credentials available
    // Otherwise fall back to playlist cover image
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    let albumArtMap = {};

    if (clientId && clientSecret) {
      try {
        const token = await getClientCredentialsToken(clientId, clientSecret);
        const trackIds = rawTracks
          .map(t => t.uri ? t.uri.split(':').pop() : '')
          .filter(id => id && /^[a-zA-Z0-9]{22}$/.test(id));

        for (let i = 0; i < trackIds.length; i += 50) {
          const chunk = trackIds.slice(i, i + 50);
          const resp = await fetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(',')}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            (data.tracks || []).forEach(t => {
              if (t && t.id) {
                albumArtMap[t.id] = t.album?.images?.[t.album.images.length - 1]?.url
                  || t.album?.images?.[0]?.url || '';
              }
            });
          }
        }
      } catch (e) {
        console.warn('Album art lookup failed, using playlist image as fallback:', e.message);
      }
    }

    // Step 3: Fetch ISRCs in parallel from boost-collective API (no auth needed)
    console.log('Fetching ISRCs from boost-collective...');
    const isrcResults = await Promise.all(
      rawTracks.map(async (t) => {
        const trackName = t.name || '';
        const artistName = t.artist || '';
        if (!trackName) return '—';
        try {
          const isrc = await fetchIsrcFromBoostCollective(trackName, artistName);
          return isrc || '—';
        } catch (e) {
          return '—';
        }
      })
    );

    // Step 4: Build final track list
    const items = rawTracks.map((t, i) => {
      const trackId = t.uri ? t.uri.split(':').pop() : '';
      return {
        track: {
          name: t.name || 'Unknown',
          artists: [{ name: t.artist || 'Unknown Artist' }],
          album: { name: 'Unknown Album' },
          external_urls: { spotify: trackId ? `https://open.spotify.com/track/${trackId}` : '' },
          external_ids: { isrc: isrcResults[i] || '—' },
          albumArt: (trackId && albumArtMap[trackId]) || playlistImage
        }
      };
    });

    return res.status(200).json({
      source: 'scraped_with_isrc_lookup',
      name: playlistData.name || playlistData.title || 'Playlist',
      owner: {
        display_name: playlistData.subtitle || 'Unknown'
      },
      images: [{ url: playlistImage }],
      tracks: {
        total: items.length,
        items: items
      }
    });

  } catch (err) {
    console.error('Error fetching playlist data:', err);
    return res.status(500).json({ error: err.message || 'Server error fetching playlist.' });
  }
};

function extractPlaylistId(urlStr) {
  try {
    const match = urlStr.match(/\/playlist\/([a-zA-Z0-9]{22})/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

// Fetch ISRC from boost-collective (no auth required)
async function fetchIsrcFromBoostCollective(trackName, artistName) {
  const resp = await fetch('https://www.boost-collective.com/api/artist-tools/isrc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'referer': 'https://www.boost-collective.com/blog/isrc-finder-tool-free',
      'origin': 'https://www.boost-collective.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    },
    body: JSON.stringify({ trackName, artistName })
  });
  if (!resp.ok) return '—';
  const data = await resp.json();
  return data.isrc || '—';
}

async function getClientCredentialsToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!resp.ok) throw new Error('Failed to retrieve Spotify access token.');
  const data = await resp.json();
  return data.access_token;
}
