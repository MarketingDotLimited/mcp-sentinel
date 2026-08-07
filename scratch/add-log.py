with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace('mock.module(...).catch(console.error);', 'mock.module(')
text = text.replace('}).catch(console.error);', '});')
text = 'process.on("unhandledRejection", err => console.error("UR:", err)); process.on("uncaughtException", err => console.error("UE:", err));\n' + text

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
