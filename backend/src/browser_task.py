import asyncio
import sys
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

from browser_use import Agent, BrowserProfile
from browser_use.llm import ChatOpenAI

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# Full profile: ...\User Data\Profile 2 — close Edge while automating to avoid profile locks.
EDGE_USER_DATA = r"C:\Users\amand\AppData\Local\Microsoft\Edge\User Data"
EDGE_PROFILE_DIRECTORY = "Profile 2"

async def main():
    task = sys.argv[1] if len(sys.argv) > 1 else ""
    if not task:
        print("No task provided", file=sys.stderr)
        sys.exit(1)

    profile = BrowserProfile(
        executable_path=EDGE_EXE,
        user_data_dir=EDGE_USER_DATA,
        profile_directory=EDGE_PROFILE_DIRECTORY,
        headless=False,
        keep_alive=False,
    )

    llm = ChatOpenAI(model="gpt-4o-mini", api_key=os.environ.get("OPENAI_API_KEY"))
    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        max_actions_per_step=3,
        max_failures=1,
        extend_system_message="Once you have navigated to the requested page and it has loaded, immediately mark the task as done. Do not take any further actions after the page is open. If a tab is closed or unavailable, mark the task as done immediately — do not reopen it.",
    )
    result = await agent.run(max_steps=5)
    print(result.final_result() or "(Task completed with no text output.)")

asyncio.run(main())
