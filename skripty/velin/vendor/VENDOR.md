# Přibalené knihovny

Velín nemá závislosti v `package.json` a nic nestahuje za běhu. Knihovny jsou přibalené tady, beze změn.
Test `test/velin3d.test.mjs` hlídá, že otisky souborů sedí s touto tabulkou.

## Three.js 0.186.1

- Licence: MIT (`three/LICENSE.txt`, v balíčku jako `LICENSE`)
- Zdroj: balíček `three@0.186.1` z npm (`https://registry.npmjs.org/three/-/three-0.186.1.tgz`)
- Integrita balíčku (npm): `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==`
- Přibalené jen soubory, které Velín načítá: jádro, ovládání kamery a efekt záře (bloom).

| Soubor | SHA-256 |
|---|---|
| `three/LICENSE.txt` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `three/build/three.core.js` | `9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6` |
| `three/build/three.module.js` | `9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea` |
| `three/examples/jsm/controls/OrbitControls.js` | `3d79d07ecb686b4e5d93232eedab255331c1beef711e13164eaa1f68655a5f2b` |
| `three/examples/jsm/postprocessing/EffectComposer.js` | `4e079a5886152d7e529a59aef644e968ab4d32c6a33ce016b36bf29b2eac26f7` |
| `three/examples/jsm/postprocessing/MaskPass.js` | `7cd08eee9d5d6f5578beaddbdcbe9c384f6873810af27f22ab7db3ceeb127aa3` |
| `three/examples/jsm/postprocessing/OutputPass.js` | `02e4a261af34de71338185e9e87f0cbe5cba9115608d984363e1269dec1d2272` |
| `three/examples/jsm/postprocessing/Pass.js` | `444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5` |
| `three/examples/jsm/postprocessing/RenderPass.js` | `817f6c3cdcd0fd41515d112359ea0532568eefb5aabd3b33903957ebca1b8a6a` |
| `three/examples/jsm/postprocessing/ShaderPass.js` | `e2500a5913b26bbf5148ceaae644c6edcff06a18b01494ee37bf856353d2ab9d` |
| `three/examples/jsm/postprocessing/UnrealBloomPass.js` | `ba8f2fcadfa6588384c9473498f974d81d120f02f0e63a0e59c265202a006b5a` |
| `three/examples/jsm/shaders/CopyShader.js` | `a33057d5ac91c43304c186ac0e8816e62bb2ed471d3a00ff3018dfd5c0389718` |
| `three/examples/jsm/shaders/LuminosityHighPassShader.js` | `5044f780b6e6cf863947f64c36fe1587132f7fbe395ada863cd1e5f0388dcf1e` |
| `three/examples/jsm/shaders/OutputShader.js` | `353479f77a8d7e2629d49ccac9fc2f5dbfdda5442e0adf867b00377a2fcb0cb2` |

## Aktualizace

1. Stáhni nový balíček z npm a ověř jeho integritu (`npm view three@<verze> dist.integrity`).
2. Nahraď soubory výše (jen tyto), `LICENSE` ulož jako `LICENSE.txt`.
3. Přepiš verzi, integritu a otisky v této tabulce. Nová verze je větší akce, schvaluje ji vlastník.
