use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=exports.def");
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let definition = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory")).join("exports.def");
        // COM discovers these DLL exports dynamically. PRIVATE keeps them out
        // of the import library, as required by MSVC (LNK4104).
        println!("cargo:rustc-link-arg-cdylib=/DEF:{}", definition.display());
    }
}
