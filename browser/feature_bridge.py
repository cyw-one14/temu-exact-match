"""Dispatch only the existing fixed image operations inside bundled WebAssembly."""
import json
from feature_worker import decode, compare, compare_orientations
from instance_match import compatible_shape, compare_instances
from outline_match import compare_outlines

def browser_feature_job(payload):
    data = json.loads(payload)
    operation = data.get('operation')
    if operation == 'outline-match':
        result = compare_outlines(data['template'], data['candidate'], decode, data.get('templateAttention'), data.get('candidateAttention'))
    elif operation == 'reference-shape':
        result = compatible_shape(data['template'], data['candidate'], decode)
    elif operation == 'instance-match':
        result = compare_instances(data['template'], data['candidate'], decode, data.get('templateAttention'))
    elif operation == 'focused-details':
        result = compare(data['template'], data['candidate'], data.get('algorithm', 'SIFT'), template_attention=data['templateAttention'], candidate_attention=data['candidateAttention'])
    else:
        result = compare_orientations(data['template'], data['candidate'], data.get('algorithm', 'SIFT'))
    return json.dumps(result, ensure_ascii=True)
