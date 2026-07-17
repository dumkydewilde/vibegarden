export type DatasetSampleUrl = {
  label: string;
  url: string;
  format: string;
};

export type DatasetItem = {
  title: string;
  description: string;
  tag: "Open data" | "Personal data";
  docsUrl: string;
  homepageUrl?: string;
  formats: string[];
  access: "No API key" | "No account" | "Account export";
  availableData: string[];
  sampleUrls: DatasetSampleUrl[];
  starterPrompt: string;
  /**
   * Pre-researched background for the Gardener: what the data concretely
   * looks like, how to grab a small bounded slice, gotchas, and a first
   * question. Lets it answer well without fetching the docs page.
   */
  briefing: string;
};

const openMeteoJson =
  "https://api.open-meteo.com/v1/forecast?latitude=52.37&longitude=4.90&current=temperature_2m,precipitation,weather_code&hourly=temperature_2m,precipitation_probability&forecast_days=2&timezone=Europe%2FAmsterdam";
const openMeteoCsv = `${openMeteoJson}&format=csv`;

export const datasets: DatasetItem[] = [
  {
    title: "Open-Meteo weather",
    description:
      "Live and historical weather without signup. Build a rain-or-bike advisor, compare terrace days, or plan around the heat.",
    tag: "Open data",
    docsUrl: "https://open-meteo.com/en/docs",
    homepageUrl: "https://open-meteo.com/",
    formats: ["JSON", "CSV", "XLSX"],
    access: "No API key",
    availableData: [
      "current conditions",
      "hourly and daily forecasts",
      "historical weather",
      "temperature, rain, wind, cloud cover, and weather codes",
    ],
    sampleUrls: [
      {
        label: "Amsterdam two-day forecast",
        url: openMeteoJson,
        format: "JSON",
      },
      {
        label: "Amsterdam two-day forecast",
        url: openMeteoCsv,
        format: "CSV",
      },
    ],
    starterPrompt:
      "Help me start a small project with Open-Meteo. Explain what this source offers in plain language, show me how the Amsterdam sample request works, suggest three useful project ideas, and give me one tiny first implementation step.",
    briefing:
      "The forecast API returns weather for a single lat/long point. The grain depends on the block you request: one hourly row is one timestamp; one daily row is one calendar day. Common fields are `temperature_2m`, `precipitation`, `precipitation_probability`, `wind_speed_10m`, `cloud_cover`, and `weather_code` (a numeric WMO code you must decode, not text). A beginner gets a bounded slice from the docs' URL builder or a direct call like the sample with `&format=csv` and `&forecast_days=1-3`; the response is a few KB, ideal to download and attach. Key gotcha: the CSV is not one clean table. It opens with a two-line metadata block (latitude, longitude, elevation, timezone and their values), a blank line, then a separate header-plus-data block per requested section (current/hourly/daily), and column names carry units like `temperature_2m (°C)`. Times are ISO 8601 in local time with no offset suffix. Free tier: no key, roughly under 10,000 calls per day, CC-BY 4.0 attribution required. Good first question: within the next 48 hours, when is rain most likely, morning or afternoon?",
  },
  {
    title: "Amsterdam open geodata",
    description:
      "Trees, playgrounds, parking, neighborhoods, and more with coordinates. Pick one layer and turn the city into a map project.",
    tag: "Open data",
    docsUrl: "https://maps.amsterdam.nl/open_geodata/",
    formats: ["GeoJSON", "CSV", "Shapefile", "WFS"],
    access: "No API key",
    availableData: [
      "public-space objects",
      "neighborhood boundaries",
      "mobility and parking features",
      "environmental and recreation layers",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me choose one beginner-friendly Amsterdam geodata layer. Explain the available formats without jargon, suggest three map projects for people who live in the city, and give me a tiny first step using GeoJSON or CSV.",
    briefing:
      "Each layer is a set of geographic objects for Amsterdam; one row or feature is one object (a green roof, a tree, a neighborhood polygon). Attributes are Dutch, for example the roofs layer has `OBJECTNUMMER`, `Adres`, `Daktype`, `Totaal_m2`, `Stadsdeel` (city district), plus geometry columns `WKT_LNG_LAT`, `LNG`, `LAT`. A beginner downloads one layer directly: CSV via `https://maps.amsterdam.nl/open_geodata/excel.php?KAARTLAAG=<CODE>&THEMA=<theme>` or GeoJSON via `geojson_lnglat.php?KAARTLAAG=<CODE>&THEMA=<theme>` (a confirmed working example is `KAARTLAAG=DAKEN&THEMA=dakenlandschap`). The exact uppercase `KAARTLAAG` code and theme are shown on each dataset's page under its download links, so read them off the page rather than guessing. Gotchas: the CSV is semicolon-delimited (not comma) with a UTF-8 BOM, some text fields contain embedded HTML like `<strong>`, and coordinates are WGS84. Files are typically small, from KB to a few MB. Good first question: which stadsdeel has the most objects in a layer, for example green roofs per district?",
  },
  {
    title: "Open Food Facts",
    description:
      "Ingredients and nutrition for millions of products. Compare snacks, flag allergens, or explore how supermarket shelves differ.",
    tag: "Open data",
    docsUrl:
      "https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/",
    homepageUrl: "https://world.openfoodfacts.org/",
    formats: ["JSON", "CSV", "JSONL"],
    access: "No API key",
    availableData: [
      "product names and brands",
      "ingredients and allergens",
      "nutrients and Nutri-Score",
      "processing and category labels",
    ],
    sampleUrls: [
      {
        label: "Selected fields for one product",
        url: "https://world.openfoodfacts.org/api/v3/product/3017620422003.json?fields=code,product_name,brands,nutriments,nutriscore_grade,nova_group,allergens_tags,ingredients_text",
        format: "JSON",
      },
    ],
    starterPrompt:
      "Help me build a small project with Open Food Facts. Explain the sample product response in plain language, suggest three food or shopping ideas, and show the smallest useful first request without downloading the full database.",
    briefing:
      "Each record is one food product identified by barcode. Fields include `code`, `product_name`, `brands`, `categories_tags`, `ingredients_text`, `allergens_tags`, the nested `nutriments` object (`energy-kcal_100g`, `sugars_100g`, `salt_100g`, `fat_100g`), `nutriscore_grade` or `nutrition_grades`, and `nova_group` (1 to 4 processing level). Do not point beginners at the full dump, which is many gigabytes. Instead use the search API for a bounded slice: `https://world.openfoodfacts.org/api/v2/search?categories_tags_en=Breakfast%20cereals&fields=code,product_name,brands,nutrition_grades,nova_group,nutriments&page_size=100` returns about 100 products as compact JSON, ideal to attach. Or grab a handful of single-product JSONs like the sample barcode URL. Gotchas: the JSON is deeply nested (nutriments, ingredient arrays, per-language fields), the same nutrient appears under several keys, coverage is crowdsourced and uneven so many fields are blank, search is rate-limited (roughly 10 requests per minute, so page rather than loop), and data is under the Open Database License (ODbL) requiring attribution and share-alike. Good first question: within one category, do higher NOVA processing groups tend to have worse Nutri-Scores or more sugar per 100g?",
  },
  {
    title: "Your Goodreads export",
    description:
      "Your reading history as one CSV. Find patterns in ratings and shelves, make a reading dashboard, or rediscover forgotten favorites.",
    tag: "Personal data",
    docsUrl: "https://www.goodreads.com/review/import",
    formats: ["CSV"],
    access: "Account export",
    availableData: [
      "book and author",
      "personal and average ratings",
      "bookshelves",
      "dates added and read",
      "reviews",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me plan a beginner project with my Goodreads export, but do not assume you can access it. Explain how to export the CSV, suggest three personal reading projects, and tell me what to inspect first after I provide the file.",
    briefing:
      "The data is a single CSV the user exports from their own Goodreads account, so the Gardener cannot fetch or see it: the user must export it and attach it to the chat. One row is one book on their shelves. Key columns include Title, Author, My Rating, Average Rating, Publisher, Number of Pages, Year Published, Original Publication Year, Date Read, Date Added, Bookshelves, Exclusive Shelf (read / currently-reading / to-read), and My Review. To export, go to My Books, then Import and Export (under Tools in the left sidebar, or goodreads.com/review/import), click Export Library, wait for the file to generate, then download the CSV. Gotchas: My Rating uses 0 to mean unrated, not a real zero; Date Read is blank for many books (especially older ones and to-read items), so read-per-year counts undercount; dates appear as YYYY/MM/DD, for example 2021/06/21, not ISO with dashes; and titles often carry series info in parentheses. Good first question: how many books did I finish per year, and did my average rating drift over time?",
  },
  {
    title: "MovieLens Latest Small",
    description:
      "A teaching-sized set of movie ratings and tags. Explore taste, surprising similarities, or the basics of a recommender.",
    tag: "Open data",
    docsUrl: "https://grouplens.org/datasets/movielens/latest/",
    homepageUrl: "https://movielens.org/",
    formats: ["CSV", "ZIP"],
    access: "No account",
    availableData: [
      "100,000 movie ratings",
      "movie titles and genres",
      "user-applied tags",
      "links to IMDb and TMDB identifiers",
    ],
    sampleUrls: [
      {
        label: "MovieLens Latest Small download (about 1 MB)",
        url: "https://files.grouplens.org/datasets/movielens/ml-latest-small.zip",
        format: "ZIP of CSV files",
      },
    ],
    starterPrompt:
      "Help me start with MovieLens Latest Small. Explain the files and how they connect, suggest three friendly movie projects that are simpler than a full recommender, and give me one first question to answer with the CSV data.",
    briefing:
      "The data is GroupLens's small MovieLens sample (last updated September 2018): about 100,000 ratings and 3,600 tag applications across roughly 9,700 movies by 600 users. It downloads as a roughly 1 MB ZIP from https://files.grouplens.org/datasets/movielens/ml-latest-small.zip containing four CSVs. ratings.csv has userId, movieId, rating, timestamp (one row per rating). movies.csv has movieId, title, genres. tags.csv has userId, movieId, tag, timestamp. links.csv has movieId, imdbId, tmdbId. Ratings use a 0.5 to 5.0 star scale in half-star steps. For a beginner: unzip first and attach the individual CSVs (DuckDB reads each directly); ratings.csv is the largest but still small. Gotchas: timestamps are Unix epoch seconds in UTC, so convert with to_timestamp() before reading dates; genres are one pipe-delimited string per movie (for example Action|Adventure|Sci-Fi) that you split to analyze; (no genres listed) is a real value; and analysis needs a join on movieId between ratings and movies. License is non-commercial. Good first question: which genres have the highest average rating, and does that hold once you ignore movies with very few ratings?",
  },
  {
    title: "CBS StatLine",
    description:
      "Official Dutch figures on people, homes, income, health, and mobility. Compare places or test a claim about how life is changing.",
    tag: "Open data",
    docsUrl:
      "https://www.cbs.nl/en-gb/onze-diensten/open-data/statline-as-open-data",
    homepageUrl: "https://opendata.cbs.nl/",
    formats: ["JSON", "CSV", "OData"],
    access: "No API key",
    availableData: [
      "population and households",
      "housing and neighborhoods",
      "income and work",
      "health, mobility, and the economy",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me find one manageable CBS StatLine table for a Dutch civic project. Explain how tables, dimensions, and filters work in plain language, suggest three questions worth asking, and keep the first data request small.",
    briefing:
      "The data is official Dutch statistics from Statistics Netherlands (CBS), published as open data via the OData protocol. Each dataset has a table id like 83765NED (key figures on Dutch districts and neighbourhoods). Data is dimension-coded: instead of one flat table you fetch several linked tables. TypedDataSet holds the actual figures (chart-ready values), where each row's dimension columns (for example RegioS, Perioden) contain codes, not names. DataProperties describes each column, and per-dimension code tables (RegioS, Perioden, and others) map those codes to human-readable Dutch labels. The OData v3 base is opendata.cbs.nl/ODataApi/odata/{tableid}/ with sub-paths like /TypedDataSet, /DataProperties, /RegioS; there is also a newer v4 catalog. Fetch a small slice by requesting TypedDataSet with $top to cap rows, or $filter on a dimension, and $format=json (CSV is also available). Gotchas: you must join codes to the code tables to get labels; codes can be space-padded (for example 'GM0363    '); field names are in Dutch; and totals appear as their own dimension codes. Good first question: how does one indicator (for example population, AantalInwoners) vary across a handful of municipalities?",
  },
  {
    title: "Your Spotify history",
    description:
      "Your lifetime listening history in JSON. Map eras in your taste, measure repeat listens, or make a group-playlist conversation starter.",
    tag: "Personal data",
    docsUrl:
      "https://support.spotify.com/article/data-rights-and-privacy-settings/",
    homepageUrl: "https://www.spotify.com/account/privacy/",
    formats: ["JSON", "ZIP"],
    access: "Account export",
    availableData: [
      "track, artist, album, and podcast names",
      "play timestamps and duration",
      "platform and country",
      "skip, shuffle, and offline indicators in extended history",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me plan a project with my Spotify data, but do not assume you can access my account. Explain which export to request, suggest three personal listening projects, point out privacy-sensitive fields, and tell me what to inspect after I provide the files.",
    briefing:
      "The data is a personal export the user requests from Spotify at spotify.com/account/privacy (the 'Download your data' tool); the Gardener cannot fetch it. There are two products. Standard 'Account data' arrives in a few days and includes `StreamingHistory_music_*.json`, an array of play events with `endTime`, `artistName`, `trackName`, and `msPlayed`. 'Extended streaming history' takes longer (Spotify states up to about 30 days, often faster) and is richer: files named `Streaming_History_Audio_*.json`, each an array of events with `ts` (when the stream ended), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`, `reason_end`, `shuffle`, `skipped`, `offline`, `platform`, and `conn_country`. Privacy-sensitive extended fields include IP address and location country, so treat the export carefully. Gotchas: `ms_played` or `msPlayed` is milliseconds (divide by 60000 for minutes); the ZIP splits history across several JSON files (about 12MB each), so attach them all; basic and extended use different field names. Good first question: which artists or tracks did you spend the most total listening time on, and how did that shift by month?",
  },
  {
    title: "Your Strava archive",
    description:
      "Routes, distances, times, and activity files from your account. Draw a personal heatmap, find neglected rides, or plan a club route.",
    tag: "Personal data",
    docsUrl:
      "https://support.strava.com/en-us/articles/15401919-exporting-your-data-and-bulk-export",
    formats: ["CSV", "GPX", "TCX", "FIT", "ZIP"],
    access: "Account export",
    availableData: [
      "activity summaries",
      "routes and GPS points",
      "timestamps and distances",
      "heart rate, cadence, power, and device data when recorded",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me plan a small project with my Strava archive, but do not assume you can access it. Explain the difference between the CSV and activity files, suggest three social or personal projects, flag location privacy, and give me a first step after I upload the export.",
    briefing:
      "The data is a personal bulk export the user requests; the Gardener cannot fetch it. Path: on Strava.com, click your name, go to Settings, the 'My Account' tab, then 'Download or Delete Your Account', 'Get Started', and 'Request your archive'. A download link arrives by email (often hours later). The ZIP's easy starting point is `activities.csv`, one row per activity with columns like `Activity ID`, `Activity Date`, `Activity Name`, `Activity Type` (Run, Ride, and so on), `Elapsed Time`, `Moving Time`, `Distance`, `Max Heart Rate`, `Elevation Gain`, and more. It also holds an `activities/` folder of per-activity GPS route traces (`.gpx`, `.fit.gz`, `.tcx.gz`), which are harder to parse and location-sensitive (they can reveal home or work). Gotchas: units are inconsistent (distance may be meters in the CSV even if the app shows km or miles; times in seconds), `.fit` files are binary and gzipped so they need a dedicated library, and long-time users can have large archives. Good first question: how does your weekly running or riding distance trend across the year, and which day of the week are you most active?",
  },
  {
    title: "Stack Overflow Developer Survey",
    description:
      "Annual responses from developers worldwide. Explore tools, careers, AI attitudes, or what people want to learn next.",
    tag: "Open data",
    docsUrl: "https://survey.stackoverflow.co/",
    formats: ["CSV", "ZIP"],
    access: "No account",
    availableData: [
      "developer roles and experience",
      "languages, databases, and tools",
      "work, education, and compensation",
      "AI use and attitudes",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me choose a focused question for the latest Stack Overflow Developer Survey. Explain the public CSV and schema, suggest three projects about tools or AI attitudes, and give me a first analysis that avoids misleading conclusions from survey data.",
    briefing:
      "The data is the annual public results of Stack Overflow's Developer Survey, freely downloadable (no personal request needed) from survey.stackoverflow.co, where each year links to its dataset (the 2025 edition is the latest, with over 49,000 responses from 177 countries). It downloads as a ZIP containing `survey_results_public.csv` (one row per anonymized respondent) plus a schema file (`survey_results_schema.csv`) mapping column names to the full question text. Key columns include `ResponseId`, `MainBranch`, `Employment`, `Country`, `EdLevel`, `YearsCode`, `YearsCodePro`, `DevType`, `LanguageHaveWorkedWith`, `LanguageWantToWorkWith`, and several AI-tool columns. The big gotcha: many select-all-that-apply columns are single strings with values joined by semicolons (for example Python;SQL;JavaScript), so they must be split before counting. Also note self-selection and sampling bias: respondents skew toward Stack Overflow users and certain regions, so results describe this sample, not all developers. `YearsCode` can contain text like 'Less than 1 year'. Good first question: which programming language do the most respondents want to work with next year (the 'most wanted' language), or what share report using AI coding tools?",
  },
  {
    title: "iNaturalist observations",
    description:
      "Community wildlife sightings from around the world. Map city biodiversity, compare seasons, or plan a nature walk.",
    tag: "Open data",
    docsUrl: "https://www.inaturalist.org/pages/developers",
    homepageUrl: "https://www.inaturalist.org/observations",
    formats: ["JSON", "CSV", "DwC-A"],
    access: "No API key",
    availableData: [
      "species and taxonomic names",
      "observation time and place",
      "photos and community identifications",
      "quality grade and project membership",
    ],
    sampleUrls: [
      {
        label: "Five observed species near Amsterdam",
        url: "https://api.inaturalist.org/v1/observations/species_counts?lat=52.37&lng=4.90&radius=10&per_page=5",
        format: "JSON",
      },
    ],
    starterPrompt:
      "Help me start an Amsterdam nature project with iNaturalist. Explain the species-count sample in plain language, suggest three outdoor or community ideas, and give me a tiny first step while noting the limits of community observations.",
    briefing:
      "The data is citizen-science wildlife sightings. One observation (one row or record) is a single sighting: the `taxon` (with scientific `name`, `preferred_common_name`, and `rank`), `observed_on` (date), `latitude` and `longitude` or `place_guess`, `quality_grade` (`casual`, `needs_id`, or `research`), the `user`, `photos`, and `identifications`. The read API at `api.inaturalist.org/v1` needs no key and returns JSON, for example `/observations/species_counts?lat=52.37&lng=4.90&radius=10&per_page=5`. For a small, bounded slice a beginner should use the Export tool at `inaturalist.org/observations/export` (it requires a free login): set filters (place, taxon, date) and download a CSV with only the columns you pick. Gotchas: the JSON is nested (records live under a `results` array; `per_page` maxes at 200 and total pagination is capped around 10,000 records, plus rate limits), coordinates for sensitive or threatened species are deliberately obscured, and community data is uneven, so filter to `quality_grade=research`. Good first question: which species are most observed in your city, and how does that shift month to month?",
  },
  {
    title: "Dutch election results",
    description:
      "Official results for national, local, European, and water-board elections. Map turnout or show how places shift over time.",
    tag: "Open data",
    docsUrl: "https://www.verkiezingsuitslagen.nl/",
    formats: ["CSV", "EML"],
    access: "No account",
    availableData: [
      "votes by party and candidate",
      "turnout and eligible voters",
      "municipal and polling-area results",
      "election history back to 1848",
    ],
    sampleUrls: [],
    starterPrompt:
      "Help me choose one Dutch election and a manageable geography for a beginner project. Explain the downloadable result formats, suggest three civic questions, and give me a first step that keeps comparisons fair across places or years.",
    briefing:
      "The data is official Dutch election results from the Kiesraad, covering Tweede Kamer, municipal, provincial, European, and water-board elections back to 1848. In the CSV, one row is typically the votes for one party (or candidate) within one municipality or polling station, alongside turnout (`opkomst`), eligible voters (`kiesgerechtigden`), and blank or invalid counts. Do not fetch verkiezingsuitslagen.nl live. The reliable, bounded route is the government open-data portal data.overheid.nl: search the Kiesraad datasets (for example 'Verkiezingsuitslag Tweede Kamer 2023' or 'Verkiezingsuitslagen Gemeenteraad 2026') and download the CSV resource for a single election. EML files (an XML standard) are also published there but are nested and harder, and the Kiesraad gives no support for the format, so a beginner should stick to CSV. Gotchas: municipal reorganizations (`herindeling`) change boundaries between years and parties merge or rename, so cross-year comparisons can be apples-to-oranges. Good first question: which party won the most votes in each municipality, or how did turnout vary geographically?",
  },
  {
    title: "Luchtmeetnet air quality",
    description:
      "Hourly readings from Dutch monitoring stations. Find cleaner times to run, compare streets, or explore pollution and weather together.",
    tag: "Open data",
    docsUrl: "https://api-docs.luchtmeetnet.nl/",
    homepageUrl: "https://www.luchtmeetnet.nl/",
    formats: ["JSON", "CSV"],
    access: "No API key",
    availableData: [
      "monitoring-station locations",
      "hourly particulate matter readings",
      "nitrogen dioxide and ozone readings",
      "air-quality index values",
    ],
    sampleUrls: [
      {
        label: "Amsterdam Van Diemenstraat station",
        url: "https://api.luchtmeetnet.nl/open_api/stations/NL49012",
        format: "JSON",
      },
      {
        label: "Recent PM2.5 measurements at that station",
        url: "https://api.luchtmeetnet.nl/open_api/measurements?station_number=NL49012&formula=PM25&order_by=timestamp_measured&order_direction=desc&page=1",
        format: "JSON",
      },
    ],
    starterPrompt:
      "Help me start a small air-quality project with Luchtmeetnet. Explain the Amsterdam station and PM2.5 sample responses, suggest three practical questions, and give me a first step that does not overstate what one station can tell us.",
    briefing:
      "The data is measurements from the Dutch national air-quality monitoring network. One record is a single station plus one formula (pollutant) at one hourly timestamp: fields are `station_number` (for example `NL49012`), `formula` (`PM25`, `PM10`, `NO2`, `O3`), `value` (in µg/m³), and `timestamp_measured` (ISO 8601, UTC). The open API at `api.luchtmeetnet.nl/open_api` needs no key: `/stations` lists sites, `/stations/{number}` gives one station's details, and `/measurements?station_number=NL49012&formula=PM25` returns readings. For a bounded slice, request one station and one formula for a short window (add `start` and `end` ISO timestamps; the range is capped at roughly a week) and save the JSON `data` array. Gotchas: the response is nested and paginated (top-level `data` plus a `pagination` object, about 25 readings per page), without `start` and `end` it defaults to the recent week, rate limits apply, and one station reflects a very local spot, not a whole city. Good first question: what does the daily PM2.5 pattern look like at one station, and does it peak at rush hour?",
  },
];

export function buildDatasetContext(item: DatasetItem) {
  const lines = [
    `Dataset source: ${item.title}`,
    `Description: ${item.description}`,
    `Type: ${item.tag}`,
    `Access: ${item.access}`,
    `Formats: ${item.formats.join(", ")}`,
    `Documentation: ${item.docsUrl}`,
    item.homepageUrl ? `Homepage: ${item.homepageUrl}` : null,
    `Available data: ${item.availableData.join("; ")}`,
  ];

  if (item.sampleUrls.length > 0) {
    lines.push(
      "Sample data:",
      ...item.sampleUrls.map(
        (sample) => `- ${sample.label} (${sample.format}): ${sample.url}`,
      ),
    );
  } else {
    lines.push(
      item.tag === "Personal data"
        ? "Sample data: none; the participant must supply their own export."
        : "Sample data: none; use the documentation to choose a bounded download or request.",
    );
  }

  lines.push("", `Briefing (pre-researched background): ${item.briefing}`);

  lines.push(
    "",
    "Rely on the briefing above instead of fetching the documentation page; only use fetch_page if the person asks for something specific it does not cover. This is source metadata, not proof that any URL or file has been fetched or analyzed. Only claim that after a tool confirms it.",
    "You can analyze this data right here: attach an open sample URL (or another small bounded request) yourself with attach_data, or have the person download a small slice (or their own export) and attach the file with the tools button. Either way it loads into their browser and you can query it with SQL and draw charts, no spreadsheet needed. Offer that instead of sending them off to Excel or Sheets.",
  );

  if (item.tag === "Personal data") {
    lines.push(
      "No participant data is included here. Do not claim access to their account or export; ask them to supply the file when they are ready.",
    );
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}
