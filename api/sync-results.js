// api/sync-results.js
// Vercel Serverless Function - appelée par un Cron Job
// Récupère les scores des matchs de la Coupe du Monde 2026 via AllSportsApi (RapidAPI)
// et les écrit dans Firestore pour TOUS les groupes existants.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBU6zrgcaQhs4p6MbPwMWcgWB2ZQeXh-mY",
  authDomain: "pronostic-inwi2026.firebaseapp.com",
  projectId: "pronostic-inwi2026",
  storageBucket: "pronostic-inwi2026.firebasestorage.app",
  messagingSenderId: "179300040255",
  appId: "1:179300040255:web:bcca61e1fa7f0ce9bec28a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Mapping nom équipe API -> nom utilisé dans matches.json
const TEAM_NAME_MAP = {
  "Mexico": "Mexique",
  "South Africa": "Afrique du Sud",
  "South Korea": "Corée du Sud",
  "Korea Republic": "Corée du Sud",
  "Czech Republic": "Tchéquie",
  "Czechia": "Tchéquie",
  "Canada": "Canada",
  "Bosnia and Herzegovina": "Bosnie-Herzégovine",
  "Bosnia-Herzegovina": "Bosnie-Herzégovine",
  "Qatar": "Qatar",
  "Switzerland": "Suisse",
  "Brazil": "Brésil",
  "Morocco": "Maroc",
  "Haiti": "Haïti",
  "Scotland": "Écosse",
  "USA": "États-Unis",
  "United States": "États-Unis",
  "Paraguay": "Paraguay",
  "Australia": "Australie",
  "Turkey": "Turquie",
  "Turkiye": "Turquie",
  "Germany": "Allemagne",
  "Curacao": "Curaçao",
  "Curaçao": "Curaçao",
  "Ivory Coast": "Côte d'Ivoire",
  "Cote d'Ivoire": "Côte d'Ivoire",
  "Ecuador": "Équateur",
  "Netherlands": "Pays-Bas",
  "Japan": "Japon",
  "Sweden": "Suède",
  "Tunisia": "Tunisie",
  "Belgium": "Belgique",
  "Egypt": "Égypte",
  "Iran": "Iran",
  "IR Iran": "Iran",
  "New Zealand": "Nouvelle-Zélande",
  "Spain": "Espagne",
  "Cape Verde": "Cap-Vert",
  "Cape Verde Islands": "Cap-Vert",
  "Saudi Arabia": "Arabie Saoudite",
  "Uruguay": "Uruguay",
  "France": "France",
  "Senegal": "Sénégal",
  "Iraq": "Irak",
  "Norway": "Norvège",
  "Argentina": "Argentine",
  "Algeria": "Algérie",
  "Austria": "Autriche",
  "Jordan": "Jordanie",
  "Portugal": "Portugal",
  "DR Congo": "RD Congo",
  "Congo DR": "RD Congo",
  "Uzbekistan": "Ouzbékistan",
  "Colombia": "Colombie",
  "England": "Angleterre",
  "Croatia": "Croatie",
  "Ghana": "Ghana",
  "Panama": "Panama"
};

function normalizeTeamName(apiName) {
  return TEAM_NAME_MAP[apiName] || apiName;
}

export default async function handler(req, res) {
  // Sécurité simple : vérifier un secret partagé (optionnel)
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Charger les matchs locaux (matches.json) pour faire la correspondance
    const matchesRes = await fetch(`${getBaseUrl(req)}/matches.json`);
    const localMatches = await matchesRes.json();

    // 2. Appeler l'API de scores en direct
    const apiRes = await fetch("https://allsportsapi2.p.rapidapi.com/api/matches/live", {
      headers: {
        "x-rapidapi-host": "allsportsapi2.p.rapidapi.com",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY
      }
    });

    if (!apiRes.ok) {
      return res.status(502).json({ error: "Erreur API externe", status: apiRes.status });
    }

    const apiData = await apiRes.json();
    const events = apiData.events || [];

    // 3. Filtrer uniquement les matchs FIFA World Cup 2026 terminés
    const finishedResults = {};

    for (const event of events) {
      const tournamentName = event.tournament?.name || "";
      const isWorldCup =
        tournamentName.toLowerCase().includes("world cup") &&
        event.season?.year === "2026";

      if (!isWorldCup) continue;

      // status.code: 100 = finished (typique sofascore-like APIs), 7 = en cours
      const statusCode = event.status?.code;
      const isFinished = statusCode === 100 || event.status?.type === "finished";

      if (!isFinished) continue;

      const homeName = normalizeTeamName(event.homeTeam?.name);
      const awayName = normalizeTeamName(event.awayTeam?.name);
      const homeScore = event.homeScore?.current;
      const awayScore = event.awayScore?.current;

      if (homeScore === undefined || awayScore === undefined) continue;

      // Trouver le match correspondant dans matches.json
      const localMatch = localMatches.find(
        (m) => m.home === homeName && m.away === awayName
      );

      if (localMatch) {
        finishedResults[localMatch.id] = { home: homeScore, away: awayScore };
      }
    }

    if (Object.keys(finishedResults).length === 0) {
      return res.status(200).json({ message: "Aucun match terminé à synchroniser", checked: events.length });
    }

    // 4. Écrire ces résultats dans Firestore pour TOUS les groupes existants
    const groupsSnap = await getDocs(collection(db, "groups"));
    let writeCount = 0;

    for (const groupDoc of groupsSnap.docs) {
      const groupCode = groupDoc.id;
      for (const [matchId, score] of Object.entries(finishedResults)) {
        await setDoc(doc(db, "groups", groupCode, "results", matchId), score);
        writeCount++;
      }
    }

    return res.status(200).json({
      message: "Synchronisation terminée",
      matchesFound: Object.keys(finishedResults).length,
      writes: writeCount,
      results: finishedResults
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["host"];
  return `${proto}://${host}`;
}
