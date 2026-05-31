import json
import os
from datetime import datetime

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "YOUR_API_KEY_HERE")
MINIMAX_BASE_URL = "https://api.minimax.io/v1"
MINIMAX_MODEL = "minimax-m2"
SUBSCRIBERS_FILE = os.path.join(os.path.dirname(__file__), "subscribers.json")

SYSTEM_PROMPT = (
    "You are a helpful recipe assistant. When given ingredients or a dish name, "
    "provide a clear recipe with dish name, brief description, prep time, cook time, "
    "servings, ingredients list, and numbered step-by-step instructions. "
    "Format your response in clean plain text."
)


def fetch_recipe(query: str) -> str:
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MINIMAX_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
    }
    response = requests.post(
        f"{MINIMAX_BASE_URL}/chat/completions",
        headers=headers,
        json=payload,
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def load_subscribers() -> list[dict]:
    if not os.path.exists(SUBSCRIBERS_FILE):
        return []
    try:
        with open(SUBSCRIBERS_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, ValueError):
        return []


def save_subscriber(email: str) -> bool:
    email = email.strip().lower()
    if not email:
        return False

    subscribers = load_subscribers()
    if any(item.get("email") == email for item in subscribers):
        return False

    subscribers.append({
        "email": email,
        "subscribed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    })
    with open(SUBSCRIBERS_FILE, "w", encoding="utf-8") as handle:
        json.dump(subscribers, handle, indent=2)
    return True


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/recipe", methods=["POST"])
def recipe():
    query = request.json.get("query", "").strip()
    if not query:
        return jsonify({"error": "Please enter a dish or ingredients."}), 400
    try:
        result = fetch_recipe(query)
        return jsonify({"recipe": result})
    except requests.HTTPError as e:
        return jsonify({"error": f"API error: {e.response.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/subscribe", methods=["POST"])
def subscribe():
    email = request.json.get("email", "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "Please enter a valid email address."}), 400
    saved = save_subscriber(email)
    if not saved:
        return jsonify({"message": "You are already subscribed."}), 200
    return jsonify({"message": "Thanks! You are now subscribed."}), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
