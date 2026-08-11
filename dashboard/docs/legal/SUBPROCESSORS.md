# Subprocessor Inventory — Draft for Confirmation

**Requires contract, region and legal review before public launch.**

| Provider/category                  | Function                                         | Broad data shared                                                                        | Status                                                          |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Groq                               | Configured LLM inference                         | Task, relevant page/context and model input                                              | Product integration                                             |
| Stripe                             | Subscription checkout, portal and billing events | Email/customer/subscription and payment-status metadata; not card details stored locally | Optional when billing enabled                                   |
| Resend                             | Transactional email delivery                     | Recipient email and service-message content                                              | Optional; development provider otherwise                        |
| S3-compatible provider             | Artifact object storage                          | Screenshots/artifact bytes and generated keys                                            | Deployment optional; local storage otherwise                    |
| PostgreSQL/hosting/backup provider | Application hosting, database and recovery       | Stored application/operational data                                                      | Deployment-dependent; vendor not selected in repository         |
| Customer webhook destination       | Customer-requested event delivery                | Selected bounded event payload                                                           | User-configured destination, not an operator-selected processor |

Do not add vendor addresses, regions, transfer mechanisms or contract claims
until the production vendor and terms are confirmed.
