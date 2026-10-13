# TLS test certificates

These public, self-signed certificates and private keys are test fixtures only.
Never use them for a deployed service. The SANs are `localhost` and
`other.example`, respectively, to test hostname verification independently of
certificate trust. They expire in 2126 and require no OpenSSL installation to
run the tests.
