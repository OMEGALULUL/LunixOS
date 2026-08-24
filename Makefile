# LUNIX — build & deploy
#
#   make build    compile rust/lunix-core -> assets/lunix_core.wasm
#   make test     run the jsdom regression suites (needs: npm i jsdom)
#   make deploy   push index.html + wasm to the R2 bucket (needs wrangler env)
#   make clean

RUST_DIR  := rust/lunix-core
WASM      := $(RUST_DIR)/target/wasm32-unknown-unknown/release/lunix_core.wasm
ASSET     := assets/lunix_core.wasm
BUCKET    := lunix

CARGO := cargo
ifeq ($(wildcard $(HOME)/.cargo/env),)
else
CARGO := . $(HOME)/.cargo/env && cargo
endif

.PHONY: build test deploy clean

build: $(ASSET)

$(ASSET): $(RUST_DIR)/src/lib.rs $(RUST_DIR)/Cargo.toml
	$(CARGO) build --release --target wasm32-unknown-unknown --manifest-path $(RUST_DIR)/Cargo.toml
	cp $(WASM) $(ASSET)
	@ls -la $(ASSET)

test:
	node tests/core.test.js
	@for t in tests/lunix-smoke*.js; do echo "== $$t =="; node $$t || exit 1; done

deploy: build
	npx wrangler r2 object put $(BUCKET)/index.html --file index.html --remote
	npx wrangler r2 object put $(BUCKET)/assets/lunix_core.wasm --file $(ASSET) --remote

clean:
	rm -rf $(RUST_DIR)/target
