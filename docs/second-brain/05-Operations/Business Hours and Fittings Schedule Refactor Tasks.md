<!-- 1. --> Freeze the ownership rule that branch Business Hours are the single source of truth for when the active branch is open.
<!-- 2. --> Freeze the ownership rule that Fitting Settings only control whether fittings are accepted, simultaneous fitting capacity, appointment duration, and fitting fee.
<!-- 3. --> Freeze the ownership rule that Calendar reads Business Hours for its visible daily time range and does not own a separate schedule.
<!-- 4. --> Freeze the ownership rule that storefront fitting availability uses the same Business Hours and closed-date rules as staff-created fittings.
<!-- 5. --> Freeze the V1 Business Hours shape as one opening time, one closing time, and a set of recurring closed weekdays for the active branch.
<!-- 6. --> Freeze the V1 rule that an open business day uses the same opening and closing time as every other open weekday.
<!-- 7. --> Freeze the V1 rule that a fitting must fit completely inside the branch Business Hours window for that local date.
<!-- 8. --> Freeze the V1 rule that a recurring closed weekday makes the branch unavailable for fittings on that weekday.
<!-- 9. --> Freeze the V1 rule that a special closed date makes the branch unavailable for fittings for that whole local date.
<!-- 10. --> Freeze the rule that existing reservation pickup and return events outside newly configured Business Hours remain visible in Calendar rather than being hidden or deleted.
<!-- 11. --> Freeze the rule that changing Business Hours must reject changes that would invalidate accepted future fitting appointments.
<!-- 12. --> Freeze the rule that changing Fitting Settings must continue rejecting changes that would invalidate accepted future fittings where the existing fitting domain already requires that protection.
<!-- 13. --> Define the canonical `BranchOperatingHours` contract in `@drezivo/contracts` with `opens_local`, `closes_local`, and `closed_weekdays`.
<!-- 14. --> Reuse or extract a provider-neutral/local-time schema for `HH:mm` branch-local times instead of keeping fitting-only time types.
<!-- 15. --> Define the canonical weekday enum for Business Hours so Settings, Calendar, Fittings, Storefront, API, and database code use the same weekday names.
<!-- 16. --> Add contract validation requiring `opens_local` to be before `closes_local` within the same local day.
<!-- 17. --> Add contract validation preventing duplicate entries in `closed_weekdays`.
<!-- 18. --> Add response contracts for reading active-branch Business Hours together with branch ID, timezone, version, and update timestamp.
<!-- 19. --> Add owner-authorized request contracts for updating active-branch Business Hours with optimistic versioning.
<!-- 20. --> Define the canonical branch closed-date contract with ID, branch ID, local date, reason, created timestamp, and version information where needed.
<!-- 21. --> Define bounded list/query contracts for special branch closed dates.
<!-- 22. --> Define create, update, and remove contracts for special branch closed dates.
<!-- 23. --> Remove `weekly_hours` from the public `FittingSettings` contract.
<!-- 24. --> Remove `FittingWeeklyHours`, fitting weekday/window contracts, fitting weekly-hours update requests, and fitting weekly-hours update responses once all callers are migrated.
<!-- 25. --> Remove `FittingClosure` and all fitting-closure list/create/update/remove contracts once branch closed-date contracts replace them.
<!-- 26. --> Update OpenAPI generation to expose Business Hours and branch closed-date endpoints and remove obsolete fitting weekly-hours and fitting-closure endpoints.
<!-- 27. --> Regenerate the checked-in OpenAPI specification after the contract changes.
<!-- 28. --> Add contract tests for valid and invalid Business Hours payloads.
<!-- 29. --> Add contract tests for recurring closed weekdays.
<!-- 30. --> Add contract tests for branch closed-date create/update/remove payloads.
<!-- 31. --> Update fitting contract tests to prove Fitting Settings no longer contain weekly hours or closures.
<!-- 32. --> Add a new destructive forward migration rather than rewriting already-applied historical migrations.
<!-- 33. --> Normalize existing `branch.operating_hours` values into the new canonical Business Hours JSON shape.
<!-- 34. --> Seed branches with the intended default Business Hours matching the current normal default behavior: 08:00 to 20:00 with Sunday closed unless product defaults are changed before implementation.
<!-- 35. --> Create a branch-level `branch_closure` table for whole-day special closures.
<!-- 36. --> Give `branch_closure` tenant ID, branch ID, local date, bounded reason, timestamps, and stable ID.
<!-- 37. --> Add same-tenant branch foreign-key protection for `branch_closure`.
<!-- 38. --> Add a uniqueness rule preventing duplicate special closure rows for the same branch and local date where the product only permits one closure reason per date.
<!-- 39. --> Add indexes needed to query branch closures efficiently by tenant, branch, and local date.
<!-- 40. --> Add RLS policies and application-role privileges for `branch_closure` consistent with other branch-owned configuration tables.
<!-- 41. --> Migrate any useful existing fitting closure dates into `branch_closure` if the current development database contains data worth preserving.
<!-- 42. --> Migrate current fitting weekly-hours defaults into `branch.operating_hours` where the existing data can be represented safely by the simplified Business Hours model.
<!-- 43. --> Detect non-default legacy fitting schedules with split windows or different hours by weekday before dropping them so development data is not silently broadened.
<!-- 44. --> Decide a safe development migration behavior for non-representable legacy fitting schedules, such as failing the migration with an explicit message or resetting them only when the database is intentionally disposable.
<!-- 45. --> Remove database triggers and functions that exist only to validate `fitting_hours` window counts, overlaps, or fitting-closure timezone snapshots.
<!-- 46. --> Remove fitting-hours-only indexes and constraints.
<!-- 47. --> Remove fitting-closure-only indexes and constraints.
<!-- 48. --> Drop the `fitting_hours` table after every production query has been migrated to Business Hours.
<!-- 49. --> Drop the `fitting_closure` table after every production query has been migrated to branch closures.
<!-- 50. --> Remove `fitting_hours` and `fitting_closure` from the Drizzle fitting schema.
<!-- 51. --> Add the `branch_closure` table to the Drizzle tenancy/settings schema or another branch-owned schema location that reflects its new domain ownership.
<!-- 52. --> Strongly type `branch.operating_hours` in the Drizzle schema instead of leaving it as a generic `Record<string, unknown>`.
<!-- 53. --> Update tenant/bootstrap provisioning so new branches receive canonical Business Hours directly in `branch.operating_hours`.
<!-- 54. --> Stop bootstrap provisioning from inserting default rows into `fitting_hours`.
<!-- 55. --> Keep bootstrap creation of `fitting_settings` for enabled state, capacity, duration, fee, and currency.
<!-- 56. --> Add a settings repository read for the active branch Business Hours.
<!-- 57. --> Add a settings repository mutation for active-branch Business Hours with optimistic version protection.
<!-- 58. --> Add settings repository reads for bounded branch closed dates.
<!-- 59. --> Add settings repository commands to create branch closed dates.
<!-- 60. --> Add settings repository commands to update branch closed dates.
<!-- 61. --> Add settings repository commands to remove branch closed dates.
<!-- 62. --> Keep tenant and active branch authority server-derived from authenticated actor context rather than accepting tenant or authoritative branch IDs from browser payloads.
<!-- 63. --> Add owner/appropriate policy authorization to Business Hours and branch-closure mutations.
<!-- 64. --> Add audit events for Business Hours changes without logging unnecessary personal or secret data.
<!-- 65. --> Add audit events for branch closed-date create, update, and remove operations.
<!-- 66. --> Add a backend guard that checks proposed Business Hours against accepted future fittings before committing a change.
<!-- 67. --> Add a backend guard that checks a proposed recurring closed weekday against accepted future fittings before committing a change.
<!-- 68. --> Add a backend guard that checks a proposed special closed date against accepted future fittings before committing a change.
<!-- 69. --> Return a clear conflict response when a Business Hours change would invalidate an accepted future fitting.
<!-- 70. --> Add Settings controllers and routes for reading and updating Business Hours.
<!-- 71. --> Add Settings controllers and routes for listing, creating, updating, and removing branch closed dates.
<!-- 72. --> Add middleware/schema validation for all new Settings Business Hours and branch-closure endpoints.
<!-- 73. --> Add the new Business Hours and branch-closure methods to the frontend Drezivo API client.
<!-- 74. --> Remove frontend API-client methods for updating fitting weekly hours.
<!-- 75. --> Remove frontend API-client methods for listing, creating, updating, and removing fitting closures.
<!-- 76. --> Simplify the fitting schedule read repository so it no longer joins or returns `fitting_hours` or `fitting_closure`.
<!-- 77. --> Simplify fitting settings mappers so they return only enabled, capacity, duration, fee, currency, timezone, version, branch ID, and timestamps.
<!-- 78. --> Simplify fitting settings command services so they no longer own weekly-hours replacement or fitting-closure mutations.
<!-- 79. --> Remove obsolete fitting weekly-hours command functions and repositories after Business Hours owns scheduling.
<!-- 80. --> Remove obsolete fitting-closure command functions and repositories after branch closures own special closed dates.
<!-- 81. --> Rename or split any remaining `fittings.schedule.*` files whose only surviving responsibility is scalar Fitting Settings so the file names reflect their new purpose.
<!-- 82. --> Update staff fitting creation validation to read `branch.operating_hours` instead of `fitting_hours`.
<!-- 83. --> Update staff fitting creation validation to reject recurring closed weekdays from Business Hours.
<!-- 84. --> Update staff fitting creation validation to reject dates present in `branch_closure`.
<!-- 85. --> Update staff fitting reschedule validation to use the same Business Hours and branch-closure rules.
<!-- 86. --> Preserve the existing fitting timezone behavior by evaluating Business Hours in the authoritative active-branch timezone.
<!-- 87. --> Preserve the 30-minute fitting start-grid rule unless a separate product decision changes it.
<!-- 88. --> Preserve hidden fitting capacity-slot and slot-allocation enforcement because capacity remains fitting-specific and independent of Business Hours ownership.
<!-- 89. --> Preserve fitting appointment timezone snapshots and immutable appointment history.
<!-- 90. --> Update guest/storefront fitting creation validation to use Business Hours and branch closures.
<!-- 91. --> Update storefront fitting slot generation to derive candidate times from `branch.operating_hours` rather than `fitting_hours`.
<!-- 92. --> Prevent storefront slot generation on recurring closed weekdays.
<!-- 93. --> Prevent storefront slot generation on special branch closed dates.
<!-- 94. --> Ensure the entire configured fitting duration fits before Business Hours closing time when generating storefront slots.
<!-- 95. --> Keep fitting capacity conflicts independent from schedule conflicts so callers can distinguish “closed” from “fully booked.”
<!-- 96. --> Update fitting service error messages that still refer to fitting weekly hours or fitting closures so they describe Business Hours or closed dates accurately.
<!-- 97. --> Update comments and shared error documentation that describe scheduling as branch fitting hours.
<!-- 98. --> Add Business Hours state and loading/error/save behavior to the Business Information Settings page.
<!-- 99. --> Add a full-width `Business hours` section below the core business-information fields and before regional settings unless final UI review chooses a nearby equivalent placement.
<!-- 100. --> Label the Business Hours section with the active branch name so the branch-scoped ownership is visible even in the current single-branch product.
<!-- 101. --> Add an opening-time picker to Business Settings.
<!-- 102. --> Add a closing-time picker to Business Settings.
<!-- 103. --> Add recurring closed-weekday controls to Business Settings without forcing the owner to configure opening and closing times separately for every weekday.
<!-- 104. --> Add client-side validation preventing closing time from being equal to or before opening time.
<!-- 105. --> Add a concise explanation that these hours control the operational Calendar and fitting availability for the active branch.
<!-- 106. --> Add a `Special closed dates` area under Business Hours.
<!-- 107. --> Add an `Add closed date` interaction using a compact dialog, sheet, or inline form consistent with the Settings UI.
<!-- 108. --> Allow the owner to provide a local calendar date and bounded reason for a special closure.
<!-- 109. --> Allow the owner to edit a special closed date.
<!-- 110. --> Allow the owner to remove a special closed date with appropriate confirmation where destructive-action patterns require it.
<!-- 111. --> Show Business Hours save conflicts clearly when accepted future fittings prevent the change.
<!-- 112. --> Refetch authoritative Business Hours and closed dates after successful mutations.
<!-- 113. --> Keep timezone and currency read-only regional settings behavior unchanged.
<!-- 114. --> Remove the `/fittings/schedule` route completely rather than redirecting it.
115. Delete `app/src/app/(dashboard)/fittings/schedule/page.tsx`.
116. Delete the old `fitting-schedule-page.tsx` once the retained scalar controls have been moved into the new modal.
<!-- 117. --> Remove tests that exist only for the deleted Fitting Schedule & Availability page and replace their useful behavioral assertions in the new Settings/modal test suites.
<!-- 118. --> Replace the `Schedule & Availability` button on `/fittings` with a `Fitting settings` button.
<!-- 119. --> Create a Fitting Settings modal/dialog opened from `/fittings`.
<!-- 120. --> Move the `Accept fitting appointments` switch into the Fitting Settings modal.
<!-- 121. --> Move `Maximum simultaneous fittings` into the Fitting Settings modal.
<!-- 122. --> Move strict appointment duration into the Fitting Settings modal.
<!-- 123. --> Move optional fixed fitting fee into the Fitting Settings modal.
<!-- 124. --> Remove all weekly-hours controls from the Fitting Settings UI.
<!-- 125. --> Remove all date-specific closure controls from the Fitting Settings UI.
<!-- 126. --> Add a short message inside the Fitting Settings modal explaining that fittings follow active-branch Business Hours.
<!-- 127. --> Add a `Manage business hours` navigation action from the Fitting Settings modal to Business Information Settings.
<!-- 128. --> Preserve Fitting Settings loading, stale-version, validation, error, save, and retry states in the modal.
<!-- 129. --> Refresh fitting settings on `/fittings` after a successful modal save so New Fitting and page summaries use current configuration.
<!-- 130. --> Keep New Fitting disabled or otherwise guarded when fittings are disabled by Fitting Settings.
<!-- 131. --> Update New Fitting copy that currently says “operating hours” so it points to Business Hours where appropriate.
<!-- 132. --> Remove hard-coded `CALENDAR_START_HOUR = 8` and `CALENDAR_END_HOUR = 20` as authoritative business rules.
<!-- 133. --> Introduce a Calendar Business Hours model containing visible start minute, visible end minute, recurring closed weekdays, and relevant special closed dates.
<!-- 134. --> Load active-branch Business Hours when loading Calendar context.
<!-- 135. --> Load special closed dates for the visible Calendar date range using a bounded branch-closure query.
<!-- 136. --> Derive the week grid start time from Business Hours opening time.
<!-- 137. --> Derive the week grid end time from Business Hours closing time.
<!-- 138. --> Recalculate Calendar total grid height from the dynamic visible range.
<!-- 139. --> Update Calendar event positioning so top offsets are relative to the dynamic Business Hours opening minute.
<!-- 140. --> Update Calendar event clipping/visibility logic so it uses the dynamic Business Hours range rather than fixed 08:00–20:00 constants.
<!-- 141. --> Keep reservation pickup and return events outside Business Hours visible rather than silently dropping them.
<!-- 142. --> Add a safe presentation strategy for out-of-hours reservation events, such as extending the visible range enough to render them or surfacing them in an explicit outside-hours area.
<!-- 143. --> Add an `Outside business hours` visual indication to reservation events when relevant without changing reservation domain state.
<!-- 144. --> Render recurring closed weekdays as visibly muted/closed Calendar columns while keeping all seven weekdays present.
<!-- 145. --> Render special closed dates as visibly closed in Week view.
<!-- 146. --> Render recurring and special closed dates in Month view.
<!-- 147. --> Ensure closed-day styling does not hide historical or already-existing operational events that must remain visible.
<!-- 148. --> Keep Calendar event data sourced from Reservation and Fitting records; Business Hours only control schedule framing and closed-day presentation.
<!-- 149. --> Keep Calendar Day Agenda sourced from the same operational events and do not create a separate business-hours event table.
<!-- 150. --> Update Calendar empty states so a closed day is not misleadingly described as merely having no activity.
<!-- 151. --> Update Calendar unit tests for dynamic 09:00–20:00 rendering.
<!-- 152. --> Add Calendar tests proving changing Business Hours changes the visible time grid without changing stored reservation/fitting event instants.
<!-- 153. --> Add Calendar tests proving a recurring closed Sunday remains visible as a closed column.
<!-- 154. --> Add Calendar tests proving a special closed date is marked closed.
<!-- 155. --> Add Calendar tests proving an out-of-hours existing reservation event remains discoverable.
<!-- 156. --> Add backend integration tests for reading and updating active-branch Business Hours.
<!-- 157. --> Add backend integration tests proving Business Hours updates are tenant- and branch-isolated.
<!-- 158. --> Add backend integration tests proving stale Business Hours versions fail without changing persisted state.
<!-- 159. --> Add backend integration tests for branch closed-date create, update, list, and remove operations.
<!-- 160. --> Add backend integration tests proving duplicate or invalid branch closed dates fail safely.
<!-- 161. --> Add backend integration tests proving a fitting before opening time is rejected.
<!-- 162. --> Add backend integration tests proving a fitting ending after closing time is rejected.
<!-- 163. --> Add backend integration tests proving a fitting completely inside Business Hours is accepted when capacity and other rules permit it.
<!-- 164. --> Add backend integration tests proving fittings are rejected on recurring closed weekdays.
<!-- 165. --> Add backend integration tests proving fittings are rejected on special closed dates.
<!-- 166. --> Add backend integration tests proving removing a special closed date permits a fitting again when all other rules pass.
<!-- 167. --> Add backend integration tests proving changing Business Hours cannot invalidate accepted future fittings.
<!-- 168. --> Add backend integration tests proving adding a recurring closed weekday cannot invalidate accepted future fittings.
<!-- 169. --> Add backend integration tests proving adding a special closed date cannot invalidate an accepted future fitting.
<!-- 170. --> Add backend integration tests proving fitting capacity still prevents overlapping appointments independently of Business Hours.
<!-- 171. --> Add storefront integration tests proving public fitting slots begin at the configured Business Hours opening time.
<!-- 172. --> Add storefront integration tests proving the final slot of the day fits completely before closing time.
<!-- 173. --> Add storefront integration tests proving no slots are returned on recurring closed weekdays.
<!-- 174. --> Add storefront integration tests proving no slots are returned on special closed dates.
<!-- 175. --> Add Settings frontend tests for loading and displaying Business Hours.
<!-- 176. --> Add Settings frontend tests for changing opening and closing times.
<!-- 177. --> Add Settings frontend tests for recurring closed weekdays.
<!-- 178. --> Add Settings frontend tests for adding, editing, and removing special closed dates.
<!-- 179. --> Add Settings frontend tests for Business Hours validation and server conflict messages.
<!-- 180. --> Add Fittings frontend tests for opening and closing the Fitting Settings modal.
<!-- 181. --> Add Fittings frontend tests for saving enabled state, capacity, duration, and fee from the modal.
<!-- 182. --> Add Fittings frontend tests proving no weekly-hours or closure controls remain on the Fittings page/modal.
<!-- 183. --> Add a route-level test proving `/fittings/schedule` no longer exists as a production page.
<!-- 184. --> Search the app for `Schedule & Availability`, `Weekly fitting hours`, `date-specific closures`, and `/fittings/schedule` and remove all obsolete production references.
<!-- 185. --> Search the API for `fitting_hours` and migrate every production query before dropping the table.
<!-- 186. --> Search the API for `fitting_closure` and migrate every production query before dropping the table.
<!-- 187. --> Search contracts/OpenAPI for weekly fitting-hours and fitting-closure schemas and remove all obsolete public API references.
<!-- 188. --> Search docs for statements that say Fittings own weekly operating windows or date-specific fitting closures.
<!-- 189. --> Update the PRD so branch Business Hours own operating hours and special closed dates.
<!-- 190. --> Update the TRD scheduling rules so Fittings consume Business Hours instead of owning weekly fitting windows.
<!-- 191. --> Update the canonical Data Model documents to remove `fitting_hours` and `fitting_closure` and document `branch.operating_hours` plus `branch_closure`.
<!-- 192. --> Update both ERD files to remove fitting schedule tables and add `branch_closure` plus the canonical Business Hours ownership on branch.
<!-- 193. --> Update the Fittings Backend Decision Record to document the new ownership boundary and why the old fitting schedule model was removed before production users existed.
<!-- 194. --> Update the Fittings Implementation Checklist/records so completed historical fitting-schedule work is clearly superseded rather than left as current product guidance.
<!-- 195. --> Update the Schedule Calendar operations document so Calendar Business Hours rendering is documented as framing/presentation rather than stored Calendar state.
<!-- 196. --> Update onboarding/bootstrap documentation to describe the canonical default Business Hours.
<!-- 197. --> Update any storefront documentation that says fitting availability comes from fitting-specific weekly windows.
<!-- 198. --> Remove obsolete comments in migrations, repositories, services, and frontend code that imply fitting hours are the branch operating schedule.
<!-- 199. --> Run contract build, lint, and tests after the contract/OpenAPI cleanup.
200. Run API typecheck, lint, unit tests, integration tests, and build after database and fitting-service changes.
201. Run app typecheck and the focused Settings, Fittings, and Calendar frontend tests.
202. Run storefront typecheck and fitting-availability tests.
203. Run migration verification against a disposable PostgreSQL database from an empty schema.
204. Run migration verification against a development database containing the old fitting schedule schema to prove the destructive cleanup migration succeeds safely.
205. Inspect the final database schema to verify `fitting_hours` and `fitting_closure` are gone and `branch_closure` plus canonical `branch.operating_hours` remain.
206. Manually test Business Settings by setting Business Hours to 09:00–20:00 and marking Sunday closed.
207. Manually verify Calendar changes from the previous 08:00–20:00 grid to 09:00–20:00 without a refresh inconsistency.
208. Manually verify Sunday appears as closed in Calendar.
209. Manually add a special closed date and verify it appears closed in Calendar.
210. Manually verify an 08:30 fitting is rejected when opening time is 09:00.
211. Manually verify a 09:00 fitting succeeds when duration, capacity, closed-date, and other validation rules permit it.
212. Manually verify a fitting that would end after 20:00 is rejected.
213. Manually verify storefront fitting availability uses the same 09:00–20:00 Business Hours and closed dates.
214. Manually verify the Fitting Settings modal can enable/disable fittings and change capacity, duration, and fee.
215. Manually verify `/fittings/schedule` is removed and no navigation element points to it.
216. Manually verify existing reservation pickups/returns outside Business Hours remain visible and are clearly identified rather than clipped away.
<!-- 217. --> Run a final repository search proving no production code still depends on `fitting_hours`, `fitting_closure`, or the deleted `/fittings/schedule` route.
218. Run the repository secret scan and standard CI-equivalent validation before shipping.
219. Review the final diff specifically for accidental duplicate schedule ownership between Settings, Calendar, Fittings, and Storefront.
220. Ship the refactor only when Business Hours are authoritative end-to-end, Fitting Settings contain only fitting-specific controls, Calendar reflects Business Hours dynamically, storefront/staff fitting validation share the same schedule rules, and the obsolete fitting schedule tables/routes/contracts are removed.
