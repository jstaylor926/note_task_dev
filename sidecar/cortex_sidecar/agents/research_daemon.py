import logging
import feedparser
import httpx
import json
from typing import List, Dict, Any
from cortex_sidecar.agents.base import BackgroundAgent

logger = logging.getLogger("cortex-sidecar")

class ResearchDaemon(BackgroundAgent):
    def __init__(self, categories: List[str] = ["cs.AI", "cs.LG", "cs.CL"], keywords: List[str] = [], interval_seconds: int = 21600):
        super().__init__("research_daemon", interval_seconds)
        self.categories = categories
        self.keywords = keywords
        self.base_url = "http://export.arxiv.org/api/query"

    async def run(self):
        """Fetch latest papers from ArXiv and index them."""
        query = " OR ".join([f"cat:{c}" for c in self.categories])
        params = {
            "search_query": query,
            "start": 0,
            "max_results": 10,
            "sortBy": "submittedDate",
            "sortOrder": "descending"
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(self.base_url, params=params)
                if response.status_code != 200:
                    logger.error(f"ArXiv API error: {response.status_code}")
                    return

                feed = feedparser.parse(response.text)
                new_papers = []

                for entry in feed.entries:
                    # Filter by keywords if provided
                    if self.keywords:
                        text = (entry.title + " " + entry.summary).lower()
                        if not any(k.lower() in text for k in self.keywords):
                            continue
                    
                    new_papers.append({
                        "id": entry.id.split('/')[-1],
                        "title": entry.title,
                        "summary": entry.summary,
                        "link": entry.link,
                        "published": entry.published,
                        "authors": [a.name for a in entry.authors]
                    })

                logger.info(f"ResearchDaemon: Found {len(new_papers)} papers")
                
                # Push papers to the local ingest API (through Rust)
                # In this architecture, sidecar talks back to Rust or just updates its own DB
                # Since sidecar has LanceDB, we can embed abstracts directly.
                # But for the Knowledge Graph, we need Rust to create entities.
                # For Phase 6 prototype, we'll log them and plan the "System Event" bridge.
                for paper in new_papers:
                    logger.info(f"Matched paper: {paper['title']} ({paper['id']})")
                    # TODO: Call Rust to create 'reference' entity
                    # or update LanceDB directly if we want semantic search over papers

            except Exception as e:
                logger.error(f"ResearchDaemon execution failed: {e}")
