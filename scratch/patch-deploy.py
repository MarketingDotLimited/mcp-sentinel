with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"import \{\n(.*?)\n\} from '\.\./lib/deployment\.js';", "import * as deployment from '../lib/deployment.js';", text, flags=re.DOTALL)
for name in ["parseEnvironment", "parseValidSignatureFingerprint", "validateArchiveEntries", "validateArchiveListing", "validateReleaseManifest", "validateProjectWritePaths", "validateSigningFingerprint"]:
    text = re.sub(r"(?<!deployment\.)" + name + r"\(", f"deployment.{name}(", text)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
