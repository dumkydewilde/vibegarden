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

  lines.push(
    "This is source metadata, not proof that any URL or file has been fetched or analyzed. Only claim that after a tool confirms it.",
  );

  if (item.tag === "Personal data") {
    lines.push(
      "No participant data is included here. Do not claim access to their account or export; ask them to supply the file when they are ready.",
    );
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}
