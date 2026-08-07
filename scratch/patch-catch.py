import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

cli_code = """  } catch (error) {
    console.error("CATCH ERROR:", error.stack);
    process.stderr.write(`Deployment refused: ${error.message}\\n`);
    process.exitCode = 1;
  }
}
"""

text = re.sub(r"  \} catch \(error\) \{.*?\n\}\n", cli_code, text, flags=re.DOTALL)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
