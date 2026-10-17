"""Structural checks for proposed browser contracts; no app/network/database execution."""
import copy
import json
import pathlib
import re
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = json.loads((ROOT / 'docs/contracts/dashboard/openapi.json').read_text(encoding='utf-8'))
fixtures = json.loads((ROOT / 'docs/contracts/dashboard/examples.json').read_text(encoding='utf-8'))['cases']
validate_spec(spec)
operations = {}
backlog = (ROOT / 'docs/planning/mvp-trello-backlog.md').read_text(encoding='utf-8')
capabilities = {'public', 'session', 'company.read', 'trips.submit_own', 'trips.read_own_private',
                'trips.review', 'events.respond', 'applications.manage', 'events.manage',
                'qualifications.manage', 'members.manage', 'connections.manage',
                'company.configure', 'leadership.transfer'}

def dereference(value):
    if '$ref' not in value:
        return value
    result = spec
    for part in value['$ref'].removeprefix('#/').split('/'):
        result = result[part.replace('~1', '/').replace('~0', '~')]
    return result

def validator(schema):
    # Preserve the document root for local component references; other OAS keys are annotations.
    return Draft202012Validator({**spec, **schema}, format_checker=FormatChecker())

for path, methods in spec['paths'].items():
    assert path.startswith('/api/v1/') and '/telemetry/' not in path
    for method, operation in methods.items():
        assert method in {'get', 'post', 'put', 'patch', 'delete'}
        ident = operation['operationId']
        assert ident not in operations
        operations[ident] = operation
        assert operation['x-capability'] in capabilities
        assert f"### [{operation['x-owner-card']}]" in backlog
        params = [dereference(p) for p in operation.get('parameters', [])]
        assert {p['name'] for p in params if p['in'] == 'path'} == set(re.findall(r'\{([^}]+)\}', path))
        assert all(p.get('required') for p in params if p['in'] == 'path')
        security = operation['security']
        if method != 'get':
            assert security and all('csrfHeader' in entry for entry in security)
        if operation['x-capability'] != 'public':
            assert security and all('sessionCookie' in entry for entry in security)
        if method == 'get':
            assert 'requestBody' not in operation

case_ids = set()
for case in fixtures:
    assert case['id'] not in case_ids
    case_ids.add(case['id'])
    operation = operations[case['operationId']]
    response = dereference(operation['responses'].get(str(case['status']), operation['responses']['default']))
    validator(response['content']['application/json']['schema']).validate(case['response'])
    if 'request' in case:
        request = next(iter(operation['requestBody']['content'].values()))
        validator(request['schema']).validate(case['request'])

def sample_request(operation_id):
    return copy.deepcopy(next(c['request'] for c in fixtures if c['operationId'] == operation_id and 'request' in c))

negative = []
base = sample_request('submitManualTrip')
for key, value in [('tripDate', '2026-10-17'), ('ownerId', '41000000-0000-4000-8000-000000000001'),
                   ('accepted', True), ('qualificationId', '41000000-0000-4000-8000-000000000001'),
                   ('actualDistanceM', 12500.5), ('actualDistanceM', '-5'), ('evidenceIds', [])]:
    case = copy.deepcopy(base); case[key] = value; negative.append(('ManualInput', case))
for key in ['game', 'originCityId', 'destinationCityId', 'cargoId', 'cargoMassKg', 'trailerTypeId', 'actualDistanceM']:
    case = copy.deepcopy(base); del case[key]; negative.append(('ManualInput', case))
negative.extend([
    ('RsvpInput', {'response': 'declined'}),
    ('RolesInput', {'roles': ['director'], 'reason': 'Fictional request'}),
    ('RolesInput', {'roles': ['dispatcher', 'dispatcher'], 'reason': 'Fictional request'}),
    ('Decimal', '1e6'), ('Decimal', '1.00'), ('Id', 'NOT-A-UUID'),
])
for name, operation_id, missing in [
    ('TripProposal', 'getTripProposal', 'revisionId'),
    ('QualificationRuleVersion', 'getQualificationRuleVersion', 'rules'),
]:
    value = copy.deepcopy(next(c['response']['data'] for c in fixtures if c['id'] == operation_id + ':success'))
    del value[missing]
    negative.append((name, value))
negative.extend([
    ('CatalogFieldChange', {'field': 'private_server_path', 'before': None, 'after': 'synthetic-example'}),
    ('SteamReplacementProof', {**next(c['response']['data'] for c in fixtures if c['id'] == 'getSteamReplacementProof:success'), 'providerNonce': 'NONFUNCTIONAL_EXAMPLE_ONLY'}),
    ('AssignmentHistory', {**next(c['response']['data']['items'][0] for c in fixtures if c['id'] == 'listMyQualificationAssignments:success'), 'endedAt': '2026-10-17T12:00:00+02:00'}),
])
for name, value in negative:
    assert not validator({'$ref': '#/components/schemas/' + name}).is_valid(value), name

def visible_properties(name, seen=None):
    seen = set() if seen is None else seen
    if name in seen:
        return set()
    seen.add(name)
    result = set()
    def walk(value):
        if isinstance(value, dict):
            result.update(value.get('properties', {}))
            if '$ref' in value and value['$ref'].startswith('#/components/schemas/'):
                result.update(visible_properties(value['$ref'].split('/')[-1], seen))
            for item in value.values(): walk(item)
        elif isinstance(value, list):
            for item in value: walk(item)
    walk(spec['components']['schemas'][name])
    return result

private_fields = {'email', 'declineReason', 'evidence', 'decisions', 'manualRevision', 'reviewReasonCodes', 'password', 'token'}
assert not visible_properties('EventPublic') & private_fields
assert not visible_properties('TripSummary') & private_fields
assert not visible_properties('Participant') & private_fields
assert not visible_properties('MemberProfile') & private_fields
for operation in ['decideTrip', 'decideTripProposal', 'reconcileTrips', 'reverseReconciliation']:
    assert 'not_manual_author' in operations[operation]['x-guards']
assert 'serving_director' in operations['confirmLeadershipTransfer']['x-guards']
assert 'singleton_atomic_transfer' in operations['confirmLeadershipTransfer']['x-guards']
assert 'seven_day_invitation' in operations['redeemInvitation']['x-guards']
assert 'one_show_secret_no_replay' in operations['issueTelemetryToken']['x-guards']
assert 'expected_publication_pointer' in operations['publishCatalog']['x-guards']
assert 'after_event_start' in operations['setEventAttendance']['x-guards']
assert 'atomic_auth_member_invitation_transaction' in operations['redeemInvitation']['x-guards']
assert 'do_not_change_active_link' in operations['requestSteamReplacementProof']['x-guards']
for ident in ('listManualRevisions', 'getManualRevision', 'listTripProposals', 'getTripProposal'):
    assert 'private_owner_or_staff' in operations[ident]['x-guards']
    assert 'not_company_trip_visibility' in operations[ident]['x-guards'] or ident == 'getTripProposal'
assert 'exact_proposal_revision' in operations['decideTripProposal']['x-guards']
assert 'current_trip_etag' in operations['decideTripProposal']['x-guards']
for ident in ('listQualificationRuleVersions', 'getQualificationRuleVersion'):
    assert operations[ident]['x-capability'] == 'company.read'
    assert 'immutable_published_rules_only' in operations[ident]['x-guards']
for ident in ('listCatalogChanges', 'listCatalogCoverage', 'listCatalogMappingIssues'):
    assert operations[ident]['x-capability'] == 'qualifications.manage'
    assert 'pinned_review_version' in operations[ident]['x-guards']
    assert any(p.get('name') == 'reviewVersion' and p.get('required') for p in operations[ident]['parameters'])
assert 'bound_member_and_current_identity_epoch' in operations['replaceSteam']['x-guards']
assert 'unexpired_single_use_proof' in operations['replaceSteam']['x-guards']
history = next(c['response']['data'] for c in fixtures if c['id'] == 'getTrip:resubmitted-with-history')
assert history['manualRevision']['number'] == 2
assert history['decisions'][0]['reason']
assert history['decisions'][0]['reviewedRevisionId'] != history['manualRevision']['id']
assert 'providerNonce' not in visible_properties('SteamReplacementProof')
coverage = (ROOT / 'docs/contracts/dashboard/ui-coverage.md').read_text(encoding='utf-8')
for ident in re.findall(r'`([a-z][A-Za-z0-9]+)`', coverage):
    assert ident in operations, ident
for fixture_id in re.findall(r'`([a-z][A-Za-z0-9]+:[a-z0-9_-]+)`', coverage):
    assert fixture_id in case_ids, fixture_id
original = next(c for c in fixtures if c['id'] == 'getCatalogEntity:success')['response']['data']
fallback = next(c for c in fixtures if c['id'] == 'getCatalogEntity:english-fallback')['response']['data']
assert original['id'] == fallback['id']
assert fallback['display']['requestedLocale'] == 'ru' and fallback['display']['renderedLocale'] == 'en'
assert fallback['display']['englishFallback'] is True
print(json.dumps({'openapi': spec['openapi'], 'operations': len(operations), 'structuralFixtures': len(fixtures),
                  'invalidPayloadChecks': len(negative), 'publicProjectionShapes': 4,
                  'applicationTests': False, 'databaseTests': False}))
