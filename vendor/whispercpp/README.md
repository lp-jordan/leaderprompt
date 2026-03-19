Place bundled whisper.cpp assets here for local speech follow.

Development layout:
- vendor/whispercpp/windows/whisper-cli.exe (preferred)
- vendor/whispercpp/windows/main.exe (fallback)
- vendor/whispercpp/models/ggml-tiny.en.bin

Packaged builds copy this folder into app resources automatically via electron-builder extraResources.
Environment overrides still work:
- WHISPER_CPP_PATH
- WHISPER_MODEL_PATH
