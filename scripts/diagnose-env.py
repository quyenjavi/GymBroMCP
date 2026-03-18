import base64
import json
from pathlib import Path
from typing import Optional, Dict


def _jwt_role(jwt: Optional[str]) -> Optional[str]:
    if not jwt:
        return None
    parts = jwt.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1].replace("-", "+").replace("_", "/")
    payload += "=" * ((4 - (len(payload) % 4)) % 4)
    try:
        data = json.loads(base64.b64decode(payload).decode("utf-8"))
        role = data.get("role")
        return role if isinstance(role, str) else None
    except Exception:
        return None


def _read_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    env: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        env[k] = v
    return env


env = {}
env.update(_read_env_file(Path(".env")))
env.update(_read_env_file(Path(".env.local")))

print("SUPABASE_SERVICE_ROLE_KEY role:", _jwt_role(env.get("SUPABASE_SERVICE_ROLE_KEY")))
print("SUPABASE_ANON_KEY role:", _jwt_role(env.get("SUPABASE_ANON_KEY")))
print("NEXT_PUBLIC_SUPABASE_ANON_KEY role:", _jwt_role(env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")))
