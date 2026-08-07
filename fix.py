with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# count { and }
open_braces = text.count('{')
close_braces = text.count('}')

print(f"Open: {open_braces}, Close: {close_braces}")
if open_braces > close_braces:
    text += '}\n' * (open_braces - close_braces)
elif close_braces > open_braces:
    print("too many closing braces")
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
